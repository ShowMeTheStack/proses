// The Memory lab in the page: it opens on a translation, the setup runs it again (a table design, typed addresses),
// stepping walks the frames, the allocation workbench runs, and a share link carries the setup into a fresh browser.
import { assert } from '../lib.mjs';

const L = (expr) => `(() => { const P = Proses.app.page.lab; return ${expr}; })()`;
const W = (expr) => `(() => { const P = Proses.app.page.lab; return !!(${expr}); })()`;

export default function (t) {
  t.beforeEach(async (p) => { await p.ev("(() => { localStorage.removeItem('proses.lab:memory'); return 1; })()"); });

  t.test('opens on a translation, and the setup runs it again', async (p) => {
    await p.route('labs/memory');
    await p.wait(W('P && P.res && P.frames.length > 10'));
    assert.ok(await p.exists('#labView svg .it'));
    assert.match(await p.ev("document.querySelector('#labSay').textContent"), /Address 1/);
    // a hashed table: its bucket appears in the picture
    const k = await p.ev("[...document.querySelectorAll('#lab-table option')].findIndex((o) => o.textContent === 'hashed')");
    await p.setValue('#lab-table', String(k), 'change');
    await p.wait(W("P.values.table === 'hashed' && P.res && P.res.trace.some((s) => s.kind === 'hash')"));
    // typed addresses
    await p.setValue('#lab-addrs', '0x40_0010:x 0x60_0000:w 0x40_0020:x');
    await p.wait(W("P.res && P.res.run && P.res.run.rows.length === 3"));
    assert.deepEqual(await p.ev(L('P.res.run.rows.map((r) => r.hit)')), [false, false, true], 'the third address hits the TLB');
  });

  t.test('steps through the walk to the comparison and the access time', async (p) => {
    await p.route('labs/memory');
    await p.wait(W('P && P.res'));
    await p.click('#btnLabStep'); await p.click('#btnLabStep');
    assert.equal(await p.ev(L('P.i')), 2);
    await p.ev(L('P.go(P.frames.length - 2, true)'));
    await p.sleep(200);
    assert.match(await p.ev("document.querySelector('#labSay').textContent"), /one flat table would take/);
    await p.key('ArrowRight');
    assert.match(await p.ev("document.querySelector('#labSay').textContent"), /EAT =/);
  });

  t.test('the allocation workbench: a preset, then a typed request', async (p) => {
    await p.route('labs/memory');
    await p.wait(W('P && P.res'));
    await p.ev("[...document.querySelectorAll('.lab-presets .chip')].find((c) => c.textContent.includes(" + JSON.stringify('buddy') + ")).click()");
    await p.wait(W("P.values.mode === 'alloc' && P.values.alloc === 'buddy' && P.res && P.res.run"));
    await p.setValue('#lab-ops_buddy', 'A=100 B=30 -A');
    await p.wait(W('P.res && P.res.run && P.res.run.steps.length === 3'));
    assert.equal(await p.ev(L('P.frames.length')), 4);
    assert.match(await p.ev(L("P.frames[1].say")), /128/);
  });

  t.test('a share link carries the setup into a fresh browser', async (p) => {
    await p.route('labs/memory');
    await p.wait(W('P && P.res'));
    await p.ev("[...document.querySelectorAll('.lab-presets .chip')].find((c) => c.textContent.includes(" + JSON.stringify('Sv39') + ")).click()");
    await p.wait(W('P.values.va === 39 && P.res'));
    await p.setValue('#lab-addrs', '0x1000 0x2a3f:w 0x1004');
    await p.wait(W('P.res && P.res.run && P.res.run.rows.length === 3'));
    await p.ev("(() => { window.__copied = null; Proses.Share.copy = (text) => { window.__copied = text; }; return 1; })()");
    await p.click('#btnLabShare');
    await p.wait('!!window.__copied');
    const url = await p.ev('window.__copied');
    assert.match(url, /#labs\/memory\?s=/);
    const trace = await p.ev(L('JSON.stringify(P.res.trace)'));
    await p.fresh({ hash: url.slice(url.indexOf('#') + 1) });
    await p.wait(W('P && P.res && P.values.va === 39'));
    assert.deepEqual(await p.ev(L('P.values.addrs')), ['0x1000', '0x2a3f:w', '0x1004']);
    assert.equal(await p.ev(L('JSON.stringify(P.res.trace)')), trace, 'the same run');
  });

  t.test('fits a phone', async (p) => {
    await p.route('labs/memory');
    await p.wait(W('P && P.res'));
    assert.ok(await p.fitsPhone(), 'nothing scrolls sideways');
  });
}
