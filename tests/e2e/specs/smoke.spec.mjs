// The frame of the app, as a smoke test: the top bar and its routes, the home page with its live picture and its
// section cards, themes and projector mode, settings, About and the author, a missing page, share links, the demo
// page and its players, the empty pages, and every page at phone width.
import { assert } from '../lib.mjs';

const SECTIONS = ['topics', 'learn', 'courses', 'labs', 'challenges'];
const SIBLINGS = ['See', 'Strux', 'Baysik', 'Lohgo', 'Kwery', 'Tooring', 'Sirkit', 'Sifer', 'Nooral'];

export default function (t) {
  t.test('the top bar routes to every section and lights the one open', async (p) => {
    const have = await p.ev(`${JSON.stringify(SECTIONS)}.filter((id) => !!document.querySelector('#topNav button[data-route="' + id + '"]'))`);
    assert.deepEqual(have, SECTIONS, 'sections in the bar');
    for (const id of have) {
      await p.route(id);
      assert.equal(await p.ev("(document.querySelector('#topNav button.on') || {}).dataset?.route || ''"), id, 'nav for ' + id);
    }
    await p.route('lesson=nowhere');
    assert.equal(await p.ev("document.querySelector('#topNav button.on').dataset.route"), 'learn', 'an alias lights its page');
    await p.click('#brand');
    await p.wait("location.hash === '' || location.hash === '#'");
    assert.ok(await p.exists('.hero'));
  });

  t.test('the home page: the live picture, the section cards and the eighteen parts', async (p) => {
    await p.route('');
    await p.wait("!!document.querySelector('#heroArt svg')");
    assert.match(await p.text('#heroCap'), /t = \d+/);
    assert.match(await p.ev("[...document.querySelectorAll('#heroArt text')].map((t) => t.textContent).join(' ')"), /running/);
    assert.equal(await p.count('.part-card'), 18);
    for (const id of ['toTopics', 'toLearn', 'toLabs', 'toChallenges', 'toScenes']) assert.ok(await p.exists('#' + id), id);
    await p.click('#toScenes');
    await p.wait("location.hash === '#demo'");
    await p.route('');
    await p.click('#toLabs');
    await p.wait("location.hash === '#labs'");
    assert.ok((await p.count('.lab-grid .tool-card')) >= 8, 'the planned labs');
    await p.route('');
    await p.click('#btnToTopics');
    await p.wait("location.hash === '#topics'");
    assert.equal(await p.count('section.part'), 18);
  });

  t.test('the empty pages say what is coming', async (p) => {
    await p.route('learn');
    // with no content a page says what is coming; with content it lists it
    const nLessons = await p.ev('Proses.Content.lessons.size + Proses.Content.exercises.size');
    if (!nLessons) assert.match(await p.text('#learnView'), /on their way/); else assert.ok((await p.text('#learnView')).length > 100, 'the Learn page lists its content');
    await p.route('challenges');
    const nCh = await p.ev('Proses.Content.challenges.size');
    if (!nCh) assert.match(await p.text('#challengesView'), /No challenges yet/); else assert.equal(await p.count('.ch-card'), nCh, 'a card a challenge');
    await p.route('courses');
    assert.ok(await p.exists('#coursesView'));
    // a planned lab not registered yet says it is on its way (the registry's own list, so this holds as labs arrive)
    await p.ev("Proses.Labs.planned.some((x) => x[0] === 'zz-planned') || Proses.Labs.planned.push(['zz-planned', 'Planned test lab', 'chip', 'Not built.']); 1");
    await p.route('labs/zz-planned');
    assert.match(await p.text('.notice'), /Planned test lab is on its way/);
    await p.route('labs/zz-never-a-lab');
    assert.match(await p.text('.notice'), /no lab called "zz-never-a-lab"/);
  });

  t.test('a page that is not there says so', async (p) => {
    await p.route('nowhere-at-all');
    assert.match(await p.text('.notice'), /no page called/);
  });

  t.test('light and dark, projector mode, and settings', async (p) => {
    await p.route('topics');
    const t0 = await p.theme();
    await p.click('#btnTheme');
    assert.notEqual(await p.theme(), t0);
    await p.key('t');
    assert.equal(await p.theme(), t0);
    await p.click('#btnProjector');
    assert.equal(await p.ev('document.documentElement.dataset.projector'), 'on');
    await p.key('P', { shift: true });
    assert.equal(await p.ev('document.documentElement.dataset.projector'), 'off');
    await p.click('#btnAbout');
    await p.click('.menu-pop .menu-item', 'Settings');
    assert.equal(await p.waitModal(), 'Settings');
    assert.equal(await p.ev("document.getElementById('set-autosave').checked"), true, 'autosave is on by default');
    await p.ev("(() => { const c = document.getElementById('set-autosave'); c.checked = false; c.dispatchEvent(new Event('change')); })()");
    assert.equal((await p.settings()).autosave, false, 'and can be turned off');
    await p.ev('Proses.Shell.autosave()').then((v) => assert.equal(v, false));
    await p.setValue('#set-theme', 'dark', 'change');
    assert.equal(await p.theme(), 'dark');
    await p.setValue('#set-theme', 'light', 'change');
    assert.ok(await p.exists('#engineStatus'));
    await p.closeModals();
    assert.equal((await p.settings()).theme, 'light');
  });

  t.test('the shortcuts sheet and About, with the author and every sister tool', async (p) => {
    await p.route('');
    await p.key('?');
    assert.equal(await p.waitModal(), 'Keyboard shortcuts');
    assert.match(await p.modalText(), /Light or dark/);
    await p.closeModals();
    await p.click('#btnAbout');
    await p.click('.menu-pop .menu-item', 'About Proses');
    assert.equal(await p.waitModal(), 'About Proses');
    const about = await p.modalText();
    assert.match(about, /GNU General Public License/);
    assert.match(about, /Based on Proses by Jyotiprakash Mishra/);
    for (const name of SIBLINGS) assert.match(about, new RegExp(name), name);
    await p.closeModals();
    await p.click('#btnAbout');
    await p.click('.menu-pop .menu-item', 'About the author');
    assert.equal(await p.waitModal(), 'About the author');
    const text = await p.modalText();
    assert.match(text, /Jyotiprakash Mishra/);
    for (const name of SIBLINGS) assert.match(text, new RegExp(name), name);
    assert.ok(await p.ev("!!document.querySelector('.author-photo img').getAttribute('src').startsWith('data:image/')"), 'the photo');
    await p.closeModals();
  });

  t.test('share links: a damaged one says so, a lab link for a missing lab says so', async (p) => {
    await p.ev("location.hash = 'share=P1.zAAAA'");
    await p.waitToast(/damaged|incomplete|does not look/);
    await p.wait("location.hash === '' || location.hash === '#'");
    const code = await p.ev("(async () => Proses.Share.pack({ kind: 'labs', data: { lab: 'nowhere', setup: {} } }))()");
    assert.match(code, /^P1\./);
    await p.ev(`location.hash = 'share=' + ${JSON.stringify(code)}`);
    await p.waitToast(/lab this version does not have/);
  });

  t.test('the demo page shows every sample scene, and its players step', async (p) => {
    await p.route('demo');
    const n = await p.ev('Proses.Demo.scenes.length');
    assert.ok(n >= 1, 'scenes: ' + n);
    assert.equal(await p.count('section.scene'), n);
    const id = await p.ev('Proses.Demo.scenes[0].id');
    await p.ev(`Proses.app.byId[${JSON.stringify(id)}].go(1, true)`);
    assert.match(await p.text('#' + id + ' .say'), /Step 2 of/i);
    assert.match(await p.text('#' + id + ' .say'), /admitted/);
  });

  t.test('the menu on a phone, and every page fits the phone width', async (p) => {
    await p.viewport(390, 844, { mobile: true, touch: true });
    await p.route('');
    assert.ok(await p.visible('#btnMenu'), 'the menu button');
    assert.ok(!(await p.visible('#topNav button[data-route="learn"]')), 'the sections are folded away');
    await p.click('#btnMenu');
    assert.ok(await p.visible('#topNav button[data-route="learn"]'));
    await p.click('#topNav button[data-route="learn"]');
    await p.wait("location.hash === '#learn'");
    for (const id of [''].concat(SECTIONS, ['demo'])) {
      await p.route(id);
      await p.sleep(150);
      assert.ok(await p.noHScroll(), 'the page ' + (id || 'home') + ' scrolls sideways at 390 px');
    }
    await p.viewport(1400, 900);
  });
}
