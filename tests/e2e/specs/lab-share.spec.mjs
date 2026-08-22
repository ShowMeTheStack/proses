// Share links: a lab's whole setup and seed, compressed into the URL hash, open the same lab set up the same way in
// a fresh browser; a damaged link says so; the older #share= links still open a lab.
import { assert } from '../lib.mjs';

const L = (expr) => `(() => { const P = Proses.app.page.lab; return ${expr}; })()`;

export default function (t) {
  t.test('a share link carries the setup and the seed into a fresh browser', async (p) => {
    await p.route('labs/sample-sched');
    await p.setValue('#lab-policy', '2', 'change');
    await p.setValue('.lw-table tbody tr:nth-child(1) input[data-col="bursts"]', '5 1 2');
    await p.setValue('#labSeed', '77', 'change');
    await p.sleep(300);
    await p.ev("(() => { window.__copied = null; Proses.Share.copy = (text) => { window.__copied = text; }; return 1; })()");
    await p.click('#btnLabShare');
    await p.wait('!!window.__copied');
    const url = await p.ev('window.__copied');
    assert.match(url, /#labs\/sample-sched\?s=P1\.[zr][A-Za-z0-9_-]+$/);
    const trace = await p.ev(L('JSON.stringify(P.res.trace)'));
    await p.fresh({ hash: url.slice(url.indexOf('#') + 1) });
    await p.wait(L("P && P.values.policy === 'srtn'"));
    assert.deepEqual(await p.ev(L('P.values.work[0].bursts')), [5, 1, 2]);
    assert.equal(await p.ev(L('P.seed')), 77);
    assert.equal(await p.ev("document.querySelector('#labSeed').value"), '77');
    assert.equal(await p.ev(L('JSON.stringify(P.res.trace)')), trace, 'the same run');
    assert.equal(await p.ev('location.hash'), '#labs/sample-sched', 'the code leaves the address bar once read');
  });

  t.test('a C program travels in a link', async (p) => {
    await p.route('labs/sample-proc');
    const src = 'int main(void) {\n    return 3; /* é → ∅ */\n}';
    const hash = await p.ev(`Proses.LabViews.link(Proses.Labs.get('sample-proc'), { src: ${JSON.stringify(src)}, policy: 'fifo', tty: false }, 5)`);
    await p.fresh({ hash });
    await p.wait(L('P && P.res'));
    assert.equal(await p.ev("document.querySelector('#lab-src').value"), src);
    assert.equal(await p.ev(L('P.values.tty')), false);
  });

  t.test('a damaged link says so and opens the lab as it was', async (p) => {
    await p.fresh({ hash: 'labs/sample-sched?s=P1.zAAAA' });
    await p.waitToast(/damaged|incomplete/);
    assert.ok(await p.exists('#labView'));
  });

  t.test('the Labs page still opens a #share= link to a lab', async (p) => {
    const code = await p.ev("Proses.Share.pack({ kind: 'labs', data: { lab: 'sample-bank', setup: { avail: [4, 4, 4] } } })");
    await p.route('share=' + code);
    await p.wait(L("P && P.lab.id === 'sample-bank'"));
    assert.deepEqual(await p.ev(L('P.values.avail')), [4, 4, 4]);
  });
}
