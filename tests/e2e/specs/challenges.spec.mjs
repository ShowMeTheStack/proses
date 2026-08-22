// The challenge kinds in the page: each sample challenge opens with its workspace; the scheduler's preview follows its
// fields and a good answer reaches the target; the C workspaces mark a compile error in the editor and run the sample.
import { assert } from '../lib.mjs';

const open = async (p, kind) => {
  const id = await p.ev(`(() => { const x = Proses.Challenges.kinds['${kind}'].example(); if (!Proses.Content.challenges.has(x.id)) Proses.Content.challenge(x); return x.id; })()`);
  await p.route('challenge/' + id);
  await p.wait("!!document.querySelector('#chWork > *')");
  return id;
};

export default function (t) {
  t.test('sched-tune: the preview follows the policy, and the reference answer reaches the target', async (p) => {
    await open(p, 'sched-tune');
    assert.ok(await p.exists('#chPreview .chg-lane'), 'a Gantt chart of the sample');
    const before = await p.text('#chNums');
    await p.setValue('#chPolicy', 'mlfq', 'change');
    await p.wait("getComputedStyle(document.querySelector('#chLevels').closest('label')).display !== 'none'");
    await p.wait(`document.querySelector('#chNums').innerText !== ${JSON.stringify(before)}`);
    await p.setValue('#chAllot', '2');
    await p.click('#btnSubmit');
    await p.wait("/Target reached/.test(document.querySelector('#chResult').innerText)", 15000);
    assert.match(await p.text('#chResult'), /Silver|Gold/);
  });

  t.test('sync-solution: a compile error is marked in the editor; the sample runs', async (p) => {
    await open(p, 'sync-solution');
    await p.ev("Proses.app.page.load({ src: 'int slot;\\nvoid box_init(void) { }\\nvoid post(int v) { slot = v }\\nint take(void) { return slot; }\\n' })");
    await p.click('#btnTry');
    await p.wait("!!document.querySelector('.le-msg.bad')");
    assert.match(await p.text('.le-msg'), /line 3/);
    await p.ev("Proses.app.page.load(Proses.Challenges.kinds['sync-solution'].example().solution)");
    await p.click('#btnTry');
    await p.wait("/expects/.test(document.querySelector('#chStatus').innerText)", 10000);
    assert.match(await p.text('#chOut'), /1 2 3/);
  });

  t.test('pt-design, disk-sched and shell open with their workspaces and fit a phone', async (p) => {
    for (const k of ['pt-design', 'disk-sched', 'shell']) {
      await open(p, k);
      assert.ok(await p.fitsPhone(), k + ' fits a phone');
    }
    await open(p, 'pt-design');
    await p.wait("/in all/.test(document.querySelector('#chCost').innerText)");
    await open(p, 'disk-sched');
    await p.setValue('#chDiskPolicy', 'look', 'change');
    await p.wait("/movement/.test(document.querySelector('#chDiskView').parentElement.innerText)");
    assert.equal(p.newExceptions().length, 0);
  });
}
