// The C editor in the lab shell: highlighting, line numbers, typing with auto-indent and Tab, breakpoints from the
// gutter, a compile error underlined at its line and column with the hint, each process's line tagged as the run
// steps, and named programs saved, listed and opened again in this browser.
import { assert } from '../lib.mjs';

export default function (t) {
  t.beforeEach(async (p) => { await p.ev("(() => { for (const k of Object.keys(localStorage)) if (/^proses\\.(lab|labTab|progs):sample/.test(k)) localStorage.removeItem(k); return 1; })()"); });
  t.test('the editor highlights C and numbers its lines', async (p) => {
    await p.route('labs/sample-proc');
    await p.wait("!!document.querySelector('#labView .le-hl .ck-sys')");
    const n = await p.ev("document.querySelectorAll('#labView .le-ln').length");
    const lines = await p.ev("document.querySelector('#lab-src').value.split('\\n').length");
    assert.equal(n, lines, 'a number for every line');
    assert.ok(await p.exists('.le-hl .ck-pre'), 'the preprocessor');
    assert.ok(await p.exists('.le-hl .ck-type'), 'types');
    assert.equal(await p.ev("[...document.querySelectorAll('.le-hl .ck-sys')].map((e) => e.textContent).includes('fork')"), true, 'system calls');
  });

  t.test('Enter keeps the indent and adds one after a brace; Tab indents; } outdents', async (p) => {
    await p.route('labs/sample-proc');
    await p.ev("(() => { const ed = Proses.app.page.lab.setup.editor; ed.set('int main(void) {'); ed.ta.focus(); ed.ta.setSelectionRange(16, 16); return 1; })()");
    await p.key('Enter');
    await p.type('int x = 1;');
    await p.key('Enter');
    await p.key('}');
    assert.equal(await p.ev("Proses.app.page.lab.setup.editor.get()"), 'int main(void) {\n    int x = 1;\n}');
    await p.ev("(() => { const ed = Proses.app.page.lab.setup.editor; ed.set('a\\nb'); ed.ta.focus(); ed.ta.setSelectionRange(0, 3); return 1; })()");
    await p.key('Tab');
    assert.equal(await p.ev("Proses.app.page.lab.setup.editor.get()"), '    a\n    b', 'Tab indents every selected line');
    await p.key('Tab', { shift: true });
    assert.equal(await p.ev("Proses.app.page.lab.setup.editor.get()"), 'a\nb', 'Shift+Tab outdents them');
  });

  t.test('a click in the gutter sets and clears a breakpoint', async (p) => {
    await p.route('labs/sample-proc');
    await p.click('.le-ln[data-line="8"]');
    assert.deepEqual(await p.ev("[...Proses.app.page.lab.setup.editor.breakpoints]"), [8]);
    assert.ok(await p.exists('.le-ln.bp[data-line="8"]'), 'the dot is drawn');
    await p.click('.le-ln[data-line="8"]');
    assert.deepEqual(await p.ev("[...Proses.app.page.lab.setup.editor.breakpoints]"), []);
  });

  t.test('a compile error is underlined at its line and column, with the hint', async (p) => {
    await p.route('labs/sample-proc');
    await p.ev("(() => { const ed = Proses.app.page.lab.setup.editor; ed.set(ed.get().replace('int st;', 'int st'), true); return 1; })()");
    await p.click('#btnLabRun');
    await p.wait("!!document.querySelector('.le-msg.bad')");
    const where = await p.text('.le-where');
    assert.match(where, /^line \d+, column \d+$/);
    const line = +/line (\d+)/.exec(where)[1];
    assert.ok(await p.exists('.le-ln.bad[data-line="' + line + '"]'), 'the line number is marked');
    assert.ok(await p.exists('.le-l.bad .le-err'), 'the token is underlined');
    assert.ok((await p.text('.le-msg')).length > 20, 'the message is shown');
    await p.click('.le-where');
    assert.equal(await p.ev("document.activeElement.id"), 'lab-src', 'clicking the place goes to it');
    await p.insertText(' ');
    assert.equal(await p.exists('.le-msg.bad'), false, 'an edit clears the stale error');
  });

  t.test('each process\'s line is tagged in its colour as the run steps', async (p) => {
    await p.route('labs/sample-proc');
    await p.wait("Proses.app.page.lab.frames.length > 3");
    await p.ev('Proses.app.page.lab.go(3, true)');
    const tags = await p.ev("[...document.querySelectorAll('.le-tag')].map((e) => e.className + ':' + e.textContent)");
    assert.ok(tags.length >= 1, 'tags drawn: ' + tags.join(' '));
    assert.ok(tags.every((x) => /le-tag p[0-5]/.test(x)), 'each in a process colour');
    assert.ok(await p.exists('.le-l.act'), 'the line of the process that moved is lit');
  });

  t.test('programs are saved by name, listed and opened again', async (p) => {
    await p.route('labs/sample-proc');
    await p.ev("Proses.app.page.lab.setup.editor.set('int main(void) { return 7; }', true)");
    await p.click('#leSave');
    await p.waitModal();
    await p.modalInput('seven.c');
    await p.modalButton('Save');
    assert.deepEqual(await p.ev("Proses.LabEditor.programs('sample-proc').list()"), ['seven.c']);
    await p.ev("Proses.app.page.lab.setup.editor.set('int main(void) { return 0; }', true)");
    assert.ok(await p.exists('.le-pick option[value="s:seven.c"]'), 'listed under the saved programs');
    await p.setValue('.le-pick', 's:seven.c', 'change');
    assert.equal(await p.ev("Proses.app.page.lab.setup.editor.get()"), 'int main(void) { return 7; }');
    await p.setValue('.le-pick', 'x:1', 'change');
    assert.match(await p.ev("Proses.app.page.lab.setup.editor.get()"), /orphan/, 'an example opens too');
  });

  t.test('with storage off the editor still works and says it cannot save', async (p) => {
    await p.route('labs/sample-proc');
    await p.ev("(() => { const s = Storage.prototype.setItem; window.__setItem = s; Storage.prototype.setItem = function () { throw new Error('off'); }; return 1; })()");
    try {
      await p.ev("Proses.app.page.lab.setup.editor.set('int main(void) { return 1; }', true)");
      await p.click('#leSave');
      await p.waitModal();
      await p.modalInput('x.c');
      await p.modalButton('Save');
      await p.waitToast(/storage is off/);
    } finally { await p.ev('Storage.prototype.setItem = window.__setItem; 1'); }
  });
}
