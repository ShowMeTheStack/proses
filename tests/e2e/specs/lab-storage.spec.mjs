// The Storage lab: it opens on the disk arm; a typed request queue runs and the arm serves exactly those cylinders;
// the step controls move through the run; the RAID, SSD and I/O workbenches draw; a share link carries the setup and
// the seed into a fresh browser and gives the same run; the page fits a phone.
import { assert } from '../lib.mjs';

const L = (expr) => `(() => { const P = Proses.app.page.lab; return ${expr}; })()`;

export default function (t) {
  t.beforeEach(async (p) => { await p.ev("(() => { for (const k of Object.keys(localStorage)) if (/^proses\\.(lab|labTab):storage/.test(k)) localStorage.removeItem(k); return 1; })()"); });

  t.test('opens on the disk arm with its access times', async (p) => {
    await p.route('labs/storage');
    await p.wait(L('P && P.res && P.frames.length > 3'));
    assert.ok(await p.exists('#labView svg [data-key="c0:path"]'), 'the arm’s path is drawn');
    assert.ok(await p.exists('#labView svg [data-key^="ab:"]'), 'the access-time bars are drawn');
    assert.ok((await p.text('#labSay')).length > 20, 'a sentence for the step');
  });

  t.test('a typed queue runs; step, step back and the end', async (p) => {
    await p.route('labs/storage');
    await p.wait(L('P && P.res'));
    await p.setValue('#lab-dQueue', '15 180 60 61 120');
    await p.wait(L("P.values.dQueue.join(' ') === '15 180 60 61 120' && P.res && P.res.plan && P.res.plan.reqs.length === 5"));
    assert.deepEqual(await p.ev(L('P.res.plan.runs[0].rows.map((x) => x.cyl).sort((a, b) => a - b)')), [15, 60, 61, 120, 180], 'the arm serves the typed cylinders');
    await p.ev(L('(P.pause(), P.go(0, true), 1)'));
    await p.click('#btnLabStep');
    await p.click('#btnLabStep');
    assert.equal(await p.ev(L('P.i')), 2);
    await p.click('#btnLabBack');
    assert.equal(await p.ev(L('P.i')), 1);
    await p.ev(L('P.go(P.frames.length - 1, true)'));
    assert.match(await p.text('#labSay'), /served all 5 requests/);
  });

  t.test('RAID, SSD and I/O workbenches draw', async (p) => {
    await p.route('labs/storage');
    await p.wait(L('P && P.res'));
    await p.click('.lab-presets .chip', 'RAID 6: two disks lost, P and Q');
    await p.wait(L("P.values.mode === 'raid' && P.res && P.res.plan && P.res.plan.lost.length === 2"));
    assert.equal(await p.ev(L('String.fromCharCode(...P.res.plan.back.bytes)')), await p.ev(L('P.values.rMsg')), 'the message reads back after two failures');
    await p.ev(L('(P.pause(), P.go(P.frames.length - 1, true), 1)'));
    assert.ok(await p.exists('#labView svg [data-key^="rg:"]'), 'the stripe grid is drawn');
    await p.click('.lab-presets .chip', 'SSD: hot and cold, cost-benefit');
    await p.wait(L("P.values.mode === 'ssd' && P.res && P.res.plan && P.res.plan.stats"));
    assert.ok(await p.exists('#labView svg [data-key="wa:line"]'), 'write amplification is plotted');
    await p.click('.lab-presets .chip', 'I/O: the life of a read');
    await p.wait(L("P.values.mode === 'io' && P.res && P.res.result"));
    assert.ok(await p.exists('#labView svg [data-key="ly:controller"]'), 'the layers are drawn');
  });

  t.test('a share link carries the setup and the seed', async (p) => {
    await p.route('labs/storage');
    await p.wait(L('P && P.res'));
    await p.click('.lab-presets .chip', 'Disk: a seeded stream, FCFS against C-LOOK');
    await p.wait(L("P.values.dSrc === 'random' && P.res"));
    await p.setValue('#labSeed', '17', 'change');
    await p.wait(L('P.seed === 17 && P.res'));
    await p.click('#btnLabRun');
    await p.wait(L('P.res && P.res.plan'));
    await p.ev("(() => { window.__copied = null; Proses.Share.copy = (text) => { window.__copied = text; }; return 1; })()");
    await p.click('#btnLabShare');
    await p.wait('!!window.__copied');
    const url = await p.ev('window.__copied');
    assert.match(url, /#labs\/storage\?s=/);
    const trace = await p.ev(L('JSON.stringify(P.res.trace)'));
    await p.fresh({ hash: url.slice(url.indexOf('#') + 1) });
    await p.wait(L("P && P.res && P.values.dSrc === 'random'"));
    assert.equal(await p.ev(L('P.seed')), 17);
    assert.equal(await p.ev(L('JSON.stringify(P.res.trace)')), trace, 'the same run');
  });

  t.test('the I/O subsystem: cache, a changed setting, steps, a share link', async (p) => {
    await p.route('labs/storage');
    await p.wait(L('P && P.res'));
    await p.ev("(() => { const c = [...document.querySelectorAll('.lab-presets .chip')].find((x) => x.textContent === 'Cache: write-back against write-through'); c.scrollIntoView({ block: 'center' }); c.click(); return 1; })()");
    await p.wait(L("P.values.ioView === 'cache' && P.res && P.res.cache && P.res.cache.length === 2"));
    assert.ok(await p.exists('#labView svg [data-key="cb0_0"]'), 'the cache blocks are drawn');
    await p.setValue('#lab-cSize', '2');
    await p.wait(L('P.values.cSize === 2 && P.res && P.res.cache && P.res.cache[0].r.contents.length === 2'));
    await p.ev(L('(P.pause(), P.go(0, true), 1)'));
    await p.click('#btnLabStep');
    await p.click('#btnLabStep');
    assert.equal(await p.ev(L('P.i')), 2);
    await p.click('#btnLabBack');
    assert.equal(await p.ev(L('P.i')), 1);
    const writes = await p.ev(L('JSON.stringify(P.res.cache.map((x) => x.r.stats))'));
    await p.ev("(() => { window.__copied = null; Proses.Share.copy = (text) => { window.__copied = text; }; return 1; })()");
    await p.click('#btnLabShare');
    await p.wait('!!window.__copied');
    const url = await p.ev('window.__copied');
    await p.fresh({ hash: url.slice(url.indexOf('#') + 1) });
    await p.wait(L("P && P.res && P.values.ioView === 'cache' && P.values.cSize === 2"));
    assert.equal(await p.ev(L('JSON.stringify(P.res.cache.map((x) => x.r.stats))')), writes, 'the same run');
  });

  t.test('the I/O subsystem: buffering, spooling and the block queue draw', async (p) => {
    await p.route('labs/storage');
    await p.wait(L('P && P.res'));
    for (const [label, ok] of [['Buffering: none, single, double, circular', 'P.res.buf && P.res.buf.length === 4'], ['Spooling: four jobs, one printer', 'P.res.spool'], ['Block queue: noop, look and deadline', 'P.res.queue && P.res.queue.length === 3']]) {
      await p.ev(`(() => { const c = [...document.querySelectorAll('.lab-presets .chip')].find((x) => x.textContent === ${JSON.stringify(label)}); c.scrollIntoView({ block: 'center' }); c.click(); return 1; })()`);
      await p.wait(L('P.res && ' + ok));
      assert.ok(await p.exists('#labView svg .it'), label + ' draws');
    }
  });

  t.test('fits a phone', async (p) => {
    await p.route('labs/storage');
    assert.ok(await p.fitsPhone(), 'no sideways scroll at 390 px');
  });
}
