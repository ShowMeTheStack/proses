// The Virtual memory lab in the page: it opens on policies side by side, the setup runs it again (frames, a typed
// string, a policy), a C program traced in the editor tags its lines, several processes share frames, and a share
// link carries the setup and seed into a fresh browser.
import { assert } from '../lib.mjs';

const L = (expr) => `(() => { const P = Proses.app.page.lab; return ${expr}; })()`;
const W = (expr) => `(() => { const P = Proses.app.page.lab; return !!(${expr}); })()`;

export default function (t) {
  t.beforeEach(async (p) => { await p.ev("(() => { localStorage.removeItem('proses.lab:vm'); return 1; })()"); });

  t.test('opens on three policies, and the setup runs them again', async (p) => {
    await p.route('labs/vm');
    await p.wait(W('P && P.res && P.res.runs && P.res.runs.length === 3'));
    assert.ok(await p.exists('#labView svg .it'));
    await p.setValue('#lab-refs', '1 2 3 1 2 4 1 2 5');
    await p.wait(W('P.res && P.res.refs.length === 9'));
    await p.setValue('#lab-frames', '2', 'input');
    await p.wait(W('P.values.frames === 2 && P.res && P.res.runs[0].nFrames === 2'));
    const k = await p.ev("[...document.querySelectorAll('#lab-pol3 option')].findIndex((o) => o.textContent === 'Clock')");
    await p.setValue('#lab-pol3', String(k), 'change');
    await p.wait(W("P.res && P.res.runs.some((r) => r.policy === 'clock')"));
  });

  t.test('steps, then the sweep, the working set and the cost', async (p) => {
    await p.route('labs/vm');
    await p.wait(W('P && P.res'));
    await p.click('#btnLabStep');
    assert.equal(await p.ev(L('P.i')), 1);
    await p.ev(L('P.go(P.frames.length - 3, true)'));
    await p.sleep(200);
    assert.match(await p.ev("document.querySelector('#labSay').textContent"), /Faults against frames/);
    await p.key('ArrowRight');
    assert.match(await p.ev("document.querySelector('#labSay').textContent"), /working set/);
    await p.key('ArrowRight');
    assert.match(await p.ev("document.querySelector('#labSay').textContent"), /EAT =/);
  });

  t.test('a C program is traced, its lines tagged', async (p) => {
    await p.route('labs/vm');
    await p.wait(W('P && P.res'));
    await p.ev("[...document.querySelectorAll('.lab-presets .chip')].find((c) => c.textContent.includes(" + JSON.stringify('Traced from C') + ")).click()");
    await p.wait(W("P.values.source === 'c' && P.res && P.res.refs && P.res.refs.length > 10"));
    await p.wait("!!document.querySelector('.le-tag')");
  });

  t.test('several processes share the frames', async (p) => {
    await p.route('labs/vm');
    await p.wait(W('P && P.res'));
    await p.ev("[...document.querySelectorAll('.lab-presets .chip')].find((c) => c.textContent.includes(" + JSON.stringify('local quotas') + ")).click()");
    await p.wait(W("P.values.mode === 'multi' && P.res && P.res.L"));
    await p.ev(L('P.go(P.frames.length - 1, true)'));
    await p.sleep(200);
    assert.match(await p.ev("document.querySelector('#labSay').textContent"), /CPU utilisation peaks/);
  });

  t.test('a share link carries the setup and the seed', async (p) => {
    await p.route('labs/vm');
    await p.wait(W('P && P.res'));
    await p.ev("[...document.querySelectorAll('.lab-presets .chip')].find((c) => c.textContent.includes(" + JSON.stringify('phases of locality') + ")).click()");
    await p.wait(W("P.values.source === 'gen' && P.res && P.res.refs"));
    await p.setValue('#labSeed', '42', 'change');
    await p.wait(W('P.seed === 42 && P.res'));
    await p.sleep(300);
    await p.ev("(() => { window.__copied = null; Proses.Share.copy = (text) => { window.__copied = text; }; return 1; })()");
    await p.click('#btnLabShare');
    await p.wait('!!window.__copied');
    const url = await p.ev('window.__copied');
    const refs = await p.ev(L('JSON.stringify(P.res.refs)'));
    await p.fresh({ hash: url.slice(url.indexOf('#') + 1) });
    await p.wait(W("P && P.res && P.values.source === 'gen'"));
    assert.equal(await p.ev(L('P.seed')), 42);
    assert.equal(await p.ev(L('JSON.stringify(P.res.refs)')), refs, 'the same string');
  });

  t.test('fits a phone', async (p) => {
    await p.route('labs/vm');
    await p.wait(W('P && P.res'));
    assert.ok(await p.fitsPhone(), 'nothing scrolls sideways');
  });
}
