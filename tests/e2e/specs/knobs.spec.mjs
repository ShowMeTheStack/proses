// Real inputs beside the sliders: the demo scenes' select and toggle knobs (and number and text knobs) rebuild the
// frames, keep their values' types, and the topic player's select and toggle inputs run the topic again.
import { assert } from '../lib.mjs';

export default function (t) {
  t.test('a select knob picks a program by name and rebuilds the scene', async (p) => {
    await p.route('demo');
    await p.wait("!!Proses.app.byId['fork-tree'] && Proses.app.byId['fork-tree'].frames");
    const sel = 'select[data-knob="p"]';
    assert.ok(await p.exists('#fork-tree ' + sel), 'the program is a select');
    const labels = await p.ev(`[...document.querySelector('#fork-tree ${sel}').options].map((o) => o.textContent)`);
    assert.ok(labels.includes('fork three times'), labels.join(', '));
    const before = await p.ev("Proses.app.byId['fork-tree'].frames.length");
    await p.setValue('#fork-tree ' + sel, String(labels.indexOf('fork three times')), 'change');
    await p.wait(`Proses.app.byId['fork-tree'].knobs.p === ${labels.indexOf('fork three times')}`);
    await p.sleep(200);
    assert.equal(typeof (await p.ev("Proses.app.byId['fork-tree'].knobs.p")), 'number', 'the value keeps its type');
    assert.notEqual(await p.ev("Proses.app.byId['fork-tree'].frames.length"), before);
  });

  t.test('a toggle knob switches the journal on and off', async (p) => {
    await p.route('demo');
    const id = await p.ev("Proses.Demo.scenes.find((s) => (s.knobs || []).some((k) => k.type === 'toggle')).id");
    const cb = `#${id} input[type=checkbox][data-knob]`;
    const k = await p.ev(`document.querySelector('${cb}').dataset.knob`);
    const v0 = await p.ev(`Proses.app.byId['${id}'].knobs['${k}']`);
    await p.click(`#${id} .knob-toggle`);
    await p.wait(`Proses.app.byId['${id}'].knobs['${k}'] !== ${JSON.stringify(v0)}`);
    assert.equal(typeof (await p.ev(`Proses.app.byId['${id}'].knobs['${k}']`)), typeof v0, 'on and off keep the scene\'s own values');
  });

  t.test('number and text knobs, checked as typed', async (p) => {
    await p.route('demo');
    await p.ev(`(() => {
      const host = document.querySelector('.scene');
      const sc = { id: 'kn-test', tag: 't', title: 'Knob test', knobs: [{ id: 'n', label: 'count', type: 'number', min: 1, max: 9, value: 3 }, { id: 'w', label: 'word', type: 'text', value: 'abc', check: (v) => (/^[a-z]+$/.test(v) ? null : 'letters only') }],
        frames: ({ knobs }) => [{ items: [{ key: 't', kind: 'text', x: 0, y: 0, text: knobs.w + ' ' + knobs.n }], say: 'n is ' + knobs.n + ' and w is ' + knobs.w, view: { x: -50, y: -20, w: 200, h: 60 } }] };
      const pl = new Proses.Player(sc); host.before(pl.el); pl.build(); window.__kp = pl; return 1; })()`);
    await p.setValue('#kn-kn-test-n', '7', 'change');
    await p.wait('window.__kp.knobs.n === 7');
    await p.setValue('#kn-kn-test-n', '12', 'change');
    assert.ok(await p.ev("document.querySelector('#kn-kn-test-n').classList.contains('bad')"), 'out of range is marked');
    assert.equal(await p.ev('window.__kp.knobs.n'), 7, 'and not taken');
    await p.setValue('#kn-kn-test-w', 'A1', 'change');
    assert.equal(await p.ev("document.querySelector('#kn-kn-test-w').title"), 'letters only');
    await p.setValue('#kn-kn-test-w', 'xyz', 'change');
    await p.wait("window.__kp.knobs.w === 'xyz'");
    await p.sleep(150);
    assert.match(await p.text('#kn-test .say'), /n is 7 and w is xyz/);
  });

  t.test('setKnobs sets the controls and rebuilds at once (the diagram checker\'s variants)', async (p) => {
    await p.route('demo');
    await p.ev("Proses.app.byId['page-walk'].setKnobs({ page: 2, addr: 3 })");
    assert.equal(await p.ev("document.querySelector('#page-walk select[data-knob=page]').value"), '2');
    assert.equal(await p.ev("Proses.app.byId['page-walk'].knobs.addr"), 3);
  });

  t.test('the topic player draws select and toggle inputs that run the topic again', async (p) => {
    await p.route('topics');
    await p.ev(`(() => {
      if (!Proses.byId('kn-topic')) Proses.topic({ id: 'kn-topic', family: (Proses.families[0] || {}).id, title: 'Knob topic', blurb: '',
        inputs: [{ id: 'size', kind: 'select', label: 'Size', def: 4, options: [{ value: 4, label: 'four' }, { value: 8, label: 'eight' }] }, { id: 'on', kind: 'toggle', label: 'Switch', def: false }],
        run: (i) => [{ items: [{ key: 't', kind: 'text', x: 0, y: 0, text: 'size ' + i.size + ' ' + i.on }], say: 'size ' + i.size + ', switch ' + i.on }] });
      return 1; })()`);
    await p.route('topic=kn-topic');
    await p.setValue('#in-size', '1', 'change');
    await p.wait("Proses.app.page.player.input.size === 8");
    await p.click('.t-toggle');
    await p.wait("Proses.app.page.player.input.on === true");
    assert.match(await p.text('#say'), /size 8, switch true/);
  });

  t.test('topic narration sets `values` in the monospace face; definition tables light their row', async (p) => {
    await p.route('topics');
    await p.ev(`(() => {
      if (!Proses.byId('kn-def')) Proses.topic({ id: 'kn-def', family: (Proses.families[0] || {}).id, title: 'Definition table', blurb: '',
        run: () => ({ frames: [0, 1, 2].map((i) => ({ items: [{ key: 't', kind: 'text', x: 0, y: 0, text: 'row ' + i }], say: 'P' + i + ' waits \`' + (i * 3) + '\` ticks.', hl: { jobs: [String(i)] } })),
          def: { sections: [{ id: 'jobs', kind: 'table', title: 'The jobs', cols: ['Job', 'Burst'], rows: [['P0', 3], ['P1', { text: '5', cls: 'bad' }], ['P2', 2]], note: 'Bursts in ticks.' }] } }) });
      return 1; })()`);
    await p.route('topic=kn-def');
    await p.ev('Proses.app.page.player.go(1, true)');
    assert.equal(await p.ev("document.querySelector('#say .v').textContent"), '3', 'the value in backticks is a span');
    assert.ok(!(await p.text('#say')).includes('`'), 'no backtick is shown');
    await p.ev("Proses.app.page.player.showTab('def')");
    assert.ok(await p.exists('#defView table.def-table'), 'the definition table is drawn');
    assert.equal(await p.ev("document.querySelector('#defView tr.hl th').textContent"), 'P1', 'the step\'s row is lit');
    assert.ok(await p.exists('#defView td.bad'), 'a cell keeps its class');
    await p.ev("Proses.app.page.player.showTab('steps')");
    assert.ok(!(await p.text('#tabBody')).includes('`'), 'the list of steps shows no backticks either');
  });
}
