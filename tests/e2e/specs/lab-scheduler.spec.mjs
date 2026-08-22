// The Scheduler lab: it opens on three policies side by side; a typed workload and a changed quantum run again; the
// step controls move through the ticks; the workbenches switch; a share link carries the setup and the seed into a
// fresh browser and gives the same run; and the page fits a phone.
import { assert } from '../lib.mjs';

const chip = (text) => `(() => { const c = [...document.querySelectorAll('.lab-presets .chip')].find((x) => x.textContent.includes(${JSON.stringify(text)})); c.scrollIntoView({ block: 'center' }); c.click(); return 1; })()`;
const L = (expr) => `(() => { const P = Proses.app.page.lab; return ${expr}; })()`;

export default function (t) {
  t.beforeEach(async (p) => { await p.ev("(() => { for (const k of Object.keys(localStorage)) if (/^proses\\.(lab|labTab):scheduler/.test(k)) localStorage.removeItem(k); return 1; })()"); });

  t.test('opens with three charts, queues and a reason per policy', async (p) => {
    await p.route('labs/scheduler');
    await p.wait(L('P && P.res && P.frames.length > 10'));
    assert.equal(await p.ev(L('P.res.runs.length')), 3, 'FCFS, SJF and RR');
    await p.ev(L('(P.pause(), P.go(5, true), 1)'));
    assert.ok(await p.exists('#labView svg [data-key="r0g:s0"]'), 'the first chart has a segment');
    assert.ok(await p.exists('#labView svg [data-key="r2why0"]'), 'RR says why its job runs');
    assert.match(await p.text('#labSay'), /FCFS: .*RR, q = 2: /);
  });

  t.test('a typed workload and quantum run again; step and step back', async (p) => {
    await p.route('labs/scheduler');
    await p.wait(L('P && P.res'));
    await p.setValue('#lab-work tbody tr:nth-child(1) input[data-col="bursts"]', '3 2 5');
    await p.wait(L("P.values.work[0].bursts.join(' ') === '3 2 5' && P.res && P.res.runs[0].tr.jobs[0].bursts.length === 3"));
    await p.setValue('#lab-q3', '4');
    await p.wait(L("P.values.q3 === 4 && P.res && P.res.runs[2].name === 'RR, q = 4'"));
    await p.ev(L('(P.pause(), P.go(0, true), 1)'));
    await p.click('#btnLabStep');
    await p.click('#btnLabStep');
    assert.equal(await p.ev(L('P.i')), 2);
    await p.click('#btnLabBack');
    assert.equal(await p.ev(L('P.i')), 1);
    await p.ev(L('P.go(P.frames.length - 1, true)'));
    const avg = await p.ev(L("P.res.runs[2].tr.metrics.avg.waiting"));
    assert.equal(await p.ev("document.querySelector('#labView svg [data-key=\"cmp:rp2:2\"]').textContent.trim()"), String(Math.round(avg * 100) / 100), 'the table shows the engine’s mean');
  });

  t.test('the workbenches: sweep, real time and inversion', async (p) => {
    await p.route('labs/scheduler');
    await p.ev(chip('Sweep'));
    await p.wait(L("P.values.mode === 'sweep' && P.res && P.frames.length === 10"));
    await p.ev(chip('RT: RM misses'));
    await p.wait(L("P.values.mode === 'rt' && P.res && P.res.runs.length === 2"));
    assert.ok(await p.ev(L('P.res.runs[0].tr.misses.length > 0')), 'RM misses');
    await p.ev(chip('Inversion: a middle'));
    await p.wait(L("P.values.mode === 'pi' && P.res && P.res.runs.length === 3"));
  });

  t.test('a share link carries the setup and the seed', async (p) => {
    await p.route('labs/scheduler');
    await p.ev(chip('Fair shares'));
    await p.wait(L("P.values.pol1 === 'lottery' && P.res"));
    await p.setValue('#labSeed', '7', 'change');
    await p.wait(L('P.seed === 7 && P.res'));
    await p.ev("(() => { window.__copied = null; Proses.Share.copy = (text) => { window.__copied = text; }; return 1; })()");
    await p.click('#btnLabShare');
    await p.wait('!!window.__copied');
    const url = await p.ev('window.__copied');
    assert.match(url, /#labs\/scheduler\?s=/);
    const segs = await p.ev(L('JSON.stringify(P.res.runs[0].tr.segs)'));
    await p.fresh({ hash: url.slice(url.indexOf('#') + 1) });
    await p.wait(L("P && P.res && P.values.pol1 === 'lottery'"));
    assert.equal(await p.ev(L('P.seed')), 7);
    assert.equal(await p.ev(L('JSON.stringify(P.res.runs[0].tr.segs)')), segs, 'the same draws');
  });

  t.test('fits a phone', async (p) => {
    await p.route('labs/scheduler');
    assert.ok(await p.fitsPhone(), 'no sideways scroll at 390 px');
  });
}
