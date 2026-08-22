// The Shell lab (lab-shell.spec.mjs is the lab shell's own): it opens on the skeleton with the terminal; a line typed
// in the Terminal tab runs in the shell; ^C is pressed on the last line; the tests fail on the skeleton and pass on
// the reference, which stays hidden until revealed; a share link carries the shell and the lines.
import { assert } from '../lib.mjs';

const L = (expr) => `(() => { const P = Proses.app.page.lab; return ${expr}; })()`;

export default function (t) {
  t.beforeEach(async (p) => { await p.ev("(() => { for (const k of Object.keys(localStorage)) if (/^proses\\.(lab|labTab|progs):shell/.test(k)) localStorage.removeItem(k); return 1; })()"); });

  t.test('opens on the skeleton, with the shell and the terminal drawn', async (p) => {
    await p.route('labs/shell');
    await p.wait(L('P && P.frames.length > 3'));
    assert.match(await p.ev("document.querySelector('#lab-src').value"), /todo: run/);
    assert.ok(await p.exists('#labView svg [data-key="sh:box"]'), 'the shell is drawn');
    assert.ok(await p.exists('#labView svg [data-key="tm:panel"]'), 'the terminal is drawn');
    await p.click('#btnLabStep');
    assert.equal(await p.ev(L('P.i')), 1, 'a step');
  });

  t.test('a line typed in the Terminal tab runs in the shell, and ^C is pressed on it', async (p) => {
    await p.route('labs/shell');
    await p.ev("Proses.app.page.lab.setup.editor.set(Proses.ShellLab.REFERENCE, true)");
    await p.click('#btnLabRun');
    await p.click('#labTab-term');
    await p.click('#slClear');
    await p.wait(L("P.values.session === 'mine' && P.values.lines.length === 0"));
    await p.setValue('#slType', 'echo typed by hand');
    await p.click('.sl-form button');
    await p.wait(L("P.res.shell.sys.out === 'typed by hand\\n'"));
    assert.ok((await p.text('#slTermOut')).includes('typed by hand'), 'the terminal tab shows it');
    await p.setValue('#slType', 'sleep 5');
    await p.click('.sl-form button');
    await p.wait(L("P.values.lines.length === 2"));
    await p.click('#slKeyC');
    await p.wait(L("P.values.lines[1].key === 'C' && P.res.shell.sys.trace.some((e) => e.kind === 'key')"));
    assert.ok(await p.ev(L("P.res.shell.sys.trace.some((e) => e.kind === 'exit' && /SIGINT/.test(e.say))")), 'sleep is killed by ^C');
  });

  t.test('the tests fail on the skeleton and pass on the reference, revealed on request', async (p) => {
    await p.route('labs/shell');
    await p.click('#labTab-tests');
    await p.click('#slRunTests');
    await p.wait("!!document.getElementById('slPassed') && !document.querySelector('#slRunTests[disabled]')", 30000);
    assert.equal(await p.text('#slPassed'), '0/10');
    assert.ok(await p.exists('.sl-test.fail .sl-why'), 'a reason for a failure');
    await p.click('#labTab-ref');
    assert.equal(await p.exists('#slRef'), false, 'hidden at first');
    await p.click('#slReveal');
    assert.ok(await p.exists('#slRef'), 'revealed');
    await p.click('#slLoadRef');
    await p.waitModal();
    await p.modalButton('Load the reference');
    await p.wait(L("/struct job/.test(P.values.src)"));
    await p.click('#labTab-tests');
    await p.click('#slRunTests');
    await p.wait("!!document.getElementById('slPassed') && !document.querySelector('#slRunTests[disabled]')", 60000);
    assert.equal(await p.text('#slPassed'), '10/10');
  });

  t.test('a share link carries the shell and the lines', async (p) => {
    await p.route('labs/shell');
    const hash = await p.ev("Proses.LabViews.link(Proses.Labs.get('shell'), Object.assign({}, Proses.app.page.lab.values, { src: Proses.ShellLab.REFERENCE, session: 'mine', lines: [{ type: 'echo shared', key: '' }] }), 9)");
    await p.fresh({ hash });
    await p.wait(L("P && P.res && P.values.session === 'mine'"));
    assert.equal(await p.ev(L('P.seed')), 9);
    assert.equal(await p.ev(L('P.res.shell.sys.out')), 'shared\n');
  });

  t.test('fits a phone', async (p) => {
    await p.route('labs/shell');
    assert.ok(await p.fitsPhone(), 'no sideways scroll at 390 px');
  });
}
