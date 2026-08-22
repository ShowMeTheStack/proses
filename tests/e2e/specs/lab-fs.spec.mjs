// The File-system lab: it opens on the disk with its commands; typed commands run and light the blocks they change;
// the geometry and a power cut change the run; a block clicked on the map shows in the Inspect tab; the other
// workbenches draw; a share link carries the setup and the seed into a fresh browser; the page fits a phone.
import { assert } from '../lib.mjs';

const L = (expr) => `(() => { const P = Proses.app.page.lab; return ${expr}; })()`;
// a wait answers true or false, never the run itself (its images are too big to send back)
const W = (expr) => L('!!(' + expr + ')');

export default function (t) {
  t.beforeEach(async (p) => { await p.ev("(() => { for (const k of Object.keys(localStorage)) if (/^proses\\.(lab|labTab):fs/.test(k)) localStorage.removeItem(k); return 1; })()"); });

  t.test('opens on the disk, with the layout mkfs wrote', async (p) => {
    await p.route('labs/fs');
    await p.wait(W('P && P.res && P.frames.length > 5'));
    assert.ok(await p.exists('#labView svg [data-key="dm:m:b0"]'), 'the block map is drawn');
    assert.match(await p.text('#labSay'), /mkfs lays out 64 blocks of 256 bytes/);
  });

  t.test('typed commands run; step, step back; the blocks they change', async (p) => {
    await p.route('labs/fs');
    await p.wait(W('P && P.res'));
    await p.ev(L("(P.setup.editor.set('create /tide\\nwrite /tide 0 high water at six\\nappend /tide [600 bytes]'), P.values.src = P.setup.editor.get(), P.values.walk = false, P.setup.set(P.values), P.runNow(false), 1)"));
    await p.wait(W("P.res && P.res.bench && P.res.bench.recs.length === 3"));
    assert.equal(await p.ev(L('P.frames.length')), 4, 'mkfs and three commands');
    await p.ev(L('(P.pause(), P.go(0, true), 1)'));
    await p.click('#btnLabStep');
    await p.click('#btnLabStep');
    assert.equal(await p.ev(L('P.i')), 2);
    assert.match(await p.text('#labSay'), /write \/tide 0 high water at six/);
    await p.click('#btnLabBack');
    assert.equal(await p.ev(L('P.i')), 1);
    await p.ev(L('P.go(3, true)'));
    const lit = await p.ev("document.querySelectorAll('#labView svg [data-key^=\"dm:m:b\"].act').length");
    assert.ok(lit >= 3, 'the append lights its blocks (' + lit + ')');
  });

  t.test('a smaller block and a power cut change the run; inspect a block', async (p) => {
    await p.route('labs/fs');
    await p.wait(W('P && P.res'));
    await p.setValue('#lab-nblocks', '48');
    await p.wait(W("P.values.nblocks === 48 && P.res && P.res.bench && P.res.bench.first.devs[0].g.nblocks === 48"));
    await p.click('.lab-presets .chip', 'Journal: ordered, cut before the commit');
    await p.wait(W("P.values.journal === 'ordered' && P.res && P.frames.some((f) => f.title === 'power cut')"));
    await p.ev(L("(P.go(P.frames.findIndex((f) => f.title === 'replay and fsck'), true), 1)"));
    assert.match(await p.text('#labSay'), /never committed|nothing to replay|consistent/);
    await p.click('#labView svg [data-key="dm:m:b1"]');
    await p.wait("document.querySelector('#labTab-inspect.on')");
    assert.match(await p.text('#labTabBody'), /Inode bitmap/);
  });

  t.test('the other workbenches draw', async (p) => {
    await p.route('labs/fs');
    await p.wait(W('P && P.res'));
    await p.click('.lab-presets .chip', 'Tables: fork shares an offset');
    await p.wait(W("P.values.mode === 'tables' && P.frames.length > 5 && P.frames[0].title === 'before'"));
    await p.ev(L('(P.go(4, true), 1)'));
    await p.wait("!!document.querySelector('#labView svg [data-key^=\"tb:t:\"]')");
    assert.match(await p.text('#labSay'), /P2: read\(0, buf, 4\)/);
    await p.click('.lab-presets .chip', 'COW: a flipped bit, caught');
    await p.wait(W("P.values.mode === 'cow' && P.frames.length > 5 && /copy-on-write/.test(P.frames[0].say)"));
    await p.ev(L('(P.go(P.frames.length - 2, true), 1)'));
    assert.match(await p.text('#labSay'), /ECSUM/);
    await p.click('.lab-presets .chip', 'LFS: cleaning, greedy');
    await p.wait(W("P.values.mode === 'lfs' && P.frames.length > 5 && /log-structured/.test(P.frames[0].say)"));
    assert.ok(await p.exists('#labView svg [data-key^="lf:d:"]'), 'the segments are drawn');
    await p.click('.lab-presets .chip', 'NFS: a stale read inside the attribute timeout');
    await p.wait(W("P.values.mode === 'dfs' && P.frames.length > 5 && P.frames[0].title === 't = 0'"));
    await p.ev(L('(P.go(P.frames.length - 1, true), 1)'));
    assert.match(await p.text('#labSay'), /1 stale read/);
  });

  t.test('a share link carries the setup and the seed', async (p) => {
    await p.route('labs/fs');
    await p.wait(W('P && P.res'));
    await p.click('.lab-presets .chip', 'LFS: cleaning, cost-benefit');
    await p.wait(W("P.values.mode === 'lfs' && P.frames.length && /log-structured/.test(P.frames[0].say)"));
    await p.setValue('#labSeed', '17', 'change');
    await p.wait(W('P.seed === 17 && P.res'));
    await p.click('#btnLabRun');
    await p.wait(W('P.res && P.frames.length'));
    await p.ev("(() => { window.__copied = null; Proses.Share.copy = (text) => { window.__copied = text; }; return 1; })()");
    await p.click('#btnLabShare');
    await p.wait('!!window.__copied');
    const url = await p.ev('window.__copied');
    assert.match(url, /#labs\/fs\?s=/);
    const trace = await p.ev(L('JSON.stringify(P.res.trace)'));
    await p.fresh({ hash: url.slice(url.indexOf('#') + 1) });
    await p.wait(W("P && P.res && P.values.mode === 'lfs'"));
    assert.equal(await p.ev(L('P.seed')), 17);
    assert.equal(await p.ev(L('JSON.stringify(P.res.trace)')), trace, 'the same run');
  });

  t.test('fits a phone', async (p) => {
    await p.route('labs/fs');
    assert.ok(await p.fitsPhone(), 'no sideways scroll at 390 px');
  });
}
