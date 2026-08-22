// The Deadlock lab: it opens on a script with its allocation graph; the step controls move through it; a changed
// setup (the banker, a request typed) runs; a graph is drawn by clicking a process and then a resource, and an edge
// clicked away; a share link carries the setup and the seed into a fresh browser.
import { assert } from '../lib.mjs';

const L = (expr) => `(() => { const P = Proses.app.page.lab; return ${expr}; })()`;

export default function (t) {
  t.beforeEach(async (p) => { await p.ev("(() => { for (const k of Object.keys(localStorage)) if (/^proses\\.(lab|labTab):deadlock/.test(k)) localStorage.removeItem(k); return 1; })()"); });

  t.test('opens on a script: the graph, the wait-for graph and a sentence a step', async (p) => {
    await p.route('labs/deadlock');
    await p.wait(L('P && P.frames.length > 5'));
    assert.ok(await p.exists('#labView svg [data-key="g:p0"]'), 'process P0 is drawn');
    assert.ok(await p.exists('#labView svg [data-key="g:r0"]'), 'a resource box is drawn');
    await p.ev(L('(P.pause(), P.go(0, true), 1)'));
    await p.click('#btnLabStep');
    await p.click('#btnLabStep');
    assert.equal(await p.ev(L('P.i')), 2);
    await p.click('#btnLabBack');
    assert.equal(await p.ev(L('P.i')), 1);
    assert.ok((await p.text('#labSay')).length > 20, 'a sentence for the step');
    await p.ev(L('P.go(P.frames.length - 1, true)'));
    assert.match(await p.text('#labSay'), /deadlocked/);
  });

  t.test('the banker: a request typed is granted or refused', async (p) => {
    await p.route('labs/deadlock');
    await p.setValue('#lab-mode', '1', 'change');
    await p.wait(L("P.values.mode === 'bank' && P.res && P.res.bank"));
    assert.equal(await p.ev(L('P.res.bank.verdict')), 'granted');
    await p.setValue('#lab-who', '3');
    await p.click('#btnLabRun');
    await p.wait(L('P.values.who === 3 && P.res.bank && P.res.bank.verdict === "unsafe"'));
    await p.ev(L('P.go(P.frames.length - 1, true)'));
    assert.ok(await p.exists('#labView svg [data-key="ga"]'), 'the ghost of the pretended state is kept beside the outcome');
  });

  t.test('drawing: a process, then a resource, makes a request edge; an edge clicked goes', async (p) => {
    await p.route('labs/deadlock');
    await p.click('.lab-presets .chip', 'draw it yourself');
    await p.wait(L("P.values.ragFrom === 'graph' && P.res && P.res.rag && !P.res.rag.R"));
    await p.ev(L('(P.pause(), P.go(0, true), P.stage.finish(), 1)'));
    const where = L("JSON.stringify(P.frames[0].items.filter((it) => /^g:p[0-9]$/.test(it.key)).map((it) => [it.key, it.x, it.y]))");
    const before = await p.ev(where);
    assert.equal(await p.ev("getComputedStyle(document.querySelector('.lab-seed')).display"), 'none', 'no seed control in the graph mode');
    await p.click('#labView svg [data-key="g:p2"]');
    await p.wait(L("Proses.DlLab.sel === 'p2'"));
    await p.click('#labView svg [data-key="g:r0"]');
    await p.wait(L("/P2>R0/.test(P.values.edges)"));
    assert.match(await p.ev("document.querySelector('#lab-edges').value"), /P2>R0/, 'the edge is in the setup');
    await p.ev(L('(P.go(0, true), P.stage.finish(), 1)'));
    assert.equal(await p.ev(where), before, 'the nodes stay where they were');
    await p.wait(L('P.res.rag.V.det.deadlocked.length === 3'));
    await p.ev(L("(P.stage.onPick('g:ep2>r0'), 1)"));
    await p.wait(L("!/P2>R0/.test(P.values.edges)"));
    assert.equal(await p.ev(L('P.res.rag.V.det.deadlocked.length')), 0);
  });

  t.test('a share link carries the setup and the seed', async (p) => {
    await p.route('labs/deadlock');
    await p.click('.lab-presets .chip', 'circular wait off');
    await p.wait(L("P.values.mode === 'cond' && P.values.cCirc === false && P.res && P.res.cond"));
    assert.notEqual(await p.ev("getComputedStyle(document.querySelector('.lab-seed')).display"), 'none', 'the seed control shows in the conditions mode');
    await p.setValue('#labSeed', '42', 'change');
    await p.wait(L('P.seed === 42 && P.res'));
    await p.ev("(() => { window.__copied = null; Proses.Share.copy = (text) => { window.__copied = text; }; return 1; })()");
    await p.click('#btnLabShare');
    await p.wait('!!window.__copied');
    const url = await p.ev('window.__copied');
    assert.match(url, /#labs\/deadlock\?s=P1\./);
    const trace = await p.ev(L('JSON.stringify(P.res.trace)'));
    await p.fresh({ hash: url.slice(url.indexOf('#') + 1) });
    await p.wait(L("P && P.values.mode === 'cond' && P.res && P.res.cond"));
    assert.equal(await p.ev(L('P.values.cCirc')), false);
    assert.equal(await p.ev(L('P.seed')), 42);
    assert.equal(await p.ev(L('JSON.stringify(P.res.trace)')), trace, 'the same run');
  });
}
