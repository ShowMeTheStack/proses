// The VM lab: it opens on the 2-D walk; typed levels and a typed address walk exactly that address with
// (g + 1)(h + 1) − 1 reads; the step controls move through the run; the CPU, shadow, I/O and container workbenches
// draw; a share link carries the setup and the seed into a fresh browser and gives the same run; the page fits a phone.
import { assert } from '../lib.mjs';

const L = (expr) => `(() => { const P = Proses.app.page.lab; const r = (${expr}); if (typeof r !== 'object' || r === null) return r; try { JSON.stringify(r); return Array.isArray(r) ? r : !!r; } catch (e) { return !!r; } })()`;

const chip = (p, label) => p.ev(`(() => { const c = [...document.querySelectorAll('.lab-presets .chip')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); c.scrollIntoView({ block: 'center' }); c.click(); return 1; })()`);

export default function (t) {
  t.beforeEach(async (p) => { await p.ev("(() => { for (const k of Object.keys(localStorage)) if (/^proses\\.(lab|labTab):vmm/.test(k)) localStorage.removeItem(k); return 1; })()"); });

  t.test('opens on the 2-D walk', async (p) => {
    await p.route('labs/vmm');
    await p.wait(L('P && P.res && P.frames.length > 20'));
    assert.ok(await p.exists('#labView svg [data-key="gc0_0"]'), 'the walk grid is drawn');
    assert.equal(await p.ev(L('P.res.plan.N')), 24, 'four and four: 24 reads');
    assert.ok((await p.text('#labSay')).length > 20, 'a sentence for the step');
  });

  t.test('typed levels and address; step, step back and the end', async (p) => {
    await p.route('labs/vmm');
    await p.wait(L('P && P.res'));
    await p.setValue('#lab-wAddr', '0x12_3456_789a');
    await p.wait(L("P.values.wAddr === '0x12_3456_789a' && P.res && P.res.plan && P.res.plan.W.gva === 0x123456789an"));
    await p.setValue('#lab-wG', '3');
    await p.wait(L('P.values.wG === 3 && P.res && P.res.plan && P.res.plan.W.g === 3'));
    await p.setValue('#lab-wH', '2');
    await p.wait(L('P.values.wH === 2 && P.res && P.res.plan && P.res.plan.W.h === 2'));
    assert.equal(await p.ev(L("P.res.plan.W.gva.toString(16)")), '123456789a', 'the typed address is walked');
    assert.equal(await p.ev(L('P.res.plan.W.accesses')), 11, '(3 + 1)(2 + 1) − 1 = 11 reads');
    await p.ev(L('(P.pause(), P.go(0, true), 1)'));
    await p.click('#btnLabStep');
    await p.click('#btnLabStep');
    assert.equal(await p.ev(L('P.i')), 2);
    await p.click('#btnLabBack');
    assert.equal(await p.ev(L('P.i')), 1);
    await p.ev(L('P.go(P.frames.length - 1, true)'));
    assert.match(await p.text('#labSay'), /nested paging 11/);
  });

  t.test('the other workbenches draw', async (p) => {
    await p.route('labs/vmm');
    await p.wait(L('P && P.res'));
    await chip(p, 'CPU: kernel entry on old x86');
    await p.wait(L("P.values.mode === 'cpu' && P.res && P.res.plan && P.res.plan.runs"));
    assert.equal(await p.ev(L("P.res.plan.runs.find((r) => r.t.id === 'trap-emulate').R.wrong.length")), 3, 'popf, pushf and sgdt go wrong on old x86');
    await p.ev(L('(P.pause(), P.go(5, true), 1)'));
    assert.ok(await p.exists('#labView svg [data-key="f0_3"]'), 'the fates are drawn');
    await chip(p, 'Shadow or nested: a guest editing its tables');
    await p.wait(L("P.values.mode === 'sync' && P.res && P.res.plan && P.res.plan.A"));
    assert.ok(await p.ev(L('P.res.plan.A.exits > P.res.plan.B.exits')), 'shadow paging exits more for a guest editing its tables');
    await chip(p, 'I/O: three paths');
    await p.wait(L("P.values.mode === 'io' && P.res && P.res.plan && P.res.plan.cmp"));
    assert.ok(await p.exists('#labView svg [data-key="hp0_0"]'), 'the paths are drawn');
    await chip(p, 'Namespaces: sharing the host’s network');
    await p.wait(L("P.values.mode === 'ns' && P.res && P.res.plan && P.res.plan.sig"));
    assert.equal(await p.ev(L('P.res.plan.sig.ok')), false, 'a container cannot name a pid outside its namespace');
    await chip(p, 'Control groups: a leak killed, the rest run on');
    await p.wait(L("P.values.mode === 'cg' && P.res && P.res.plan && P.res.plan.R"));
    assert.deepEqual(await p.ev(L("P.res.plan.R.groups.api.killed")), ['leaky'], 'the leak is killed, in its own group');
  });

  t.test('a share link carries the setup and the seed', async (p) => {
    await p.route('labs/vmm');
    await p.wait(L('P && P.res'));
    await p.setValue('#lab-wAddr', '0x7_0000_1abc');
    await p.wait(L("P.values.wAddr === '0x7_0000_1abc' && P.res"));
    await p.setValue('#labSeed', '17', 'change');
    await p.wait(L('P.seed === 17 && P.res'));
    await p.click('#btnLabRun');
    await p.wait(L('P.res && P.res.plan'));
    await p.ev("(() => { window.__copied = null; Proses.Share.copy = (text) => { window.__copied = text; }; return 1; })()");
    await p.click('#btnLabShare');
    await p.wait('!!window.__copied');
    const url = await p.ev('window.__copied');
    assert.match(url, /#labs\/vmm\?s=/);
    const trace = await p.ev(L('JSON.stringify(P.res.trace)'));
    await p.fresh({ hash: url.slice(url.indexOf('#') + 1) });
    await p.wait(L("P && P.res && P.values.wAddr === '0x7_0000_1abc'"));
    assert.equal(await p.ev(L('P.seed')), 17);
    assert.equal(await p.ev(L('JSON.stringify(P.res.trace)')), trace, 'the same run');
  });

  t.test('fits a phone', async (p) => {
    await p.route('labs/vmm');
    assert.ok(await p.fitsPhone(), 'no sideways scroll at 390 px');
  });
}
