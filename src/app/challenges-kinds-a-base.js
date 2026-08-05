// What the challenge kinds share: labelled fields for a workspace (a number, a choice, a toggle), a panel with a
// title, a code workspace (the C editor with a "Try it" run beside it), the C limits (forbidden calls, at most so
// many lines, no main of your own) and a few checks a kind's lint uses.
//   S.ChallengeKit.num({id, label, value, min, max, step, hint, onChange}) -> {el, get(), set(v)}
//   S.ChallengeKit.select({id, label, value, options: [{value, label}], onChange}) -> {el, get(), set(v)}
//   S.ChallengeKit.toggle({id, label, value, onChange}) -> {el, get(), set(v)}
//   S.ChallengeKit.panel(title, ...children) -> element
//   S.ChallengeKit.codeWorkspace(host, x, draft, onChange, {sideTitle, tryLabel, tryIt(src) -> {ok, out, say}, tryInput: {el},
//     prefix(src) -> the source compiled for the error marks, note, show: {title, src} (a read-only listing)})
//     -> {get() -> {src}, load(answer), ed}   the editor keeps named programs under 'ch:' + x.id
//   S.ChallengeKit.bareCode(src) -> the source with comments and string literals blanked (for the limits)
//   S.ChallengeKit.cLimits(x, src) -> [sentences]   x.limits: {forbid: [names], maxLines, noMain: true}
//   S.ChallengeKit.cLimitSentences(x) -> [sentences]
//   S.ChallengeKit.range(name, v, [lo, hi]) -> a sentence when v is outside, else null
(function (S) {
  'use strict';
  const K = (S.ChallengeKit = S.ChallengeKit || {});
  const ui = () => S.UI;

  K.range = function (name, v, r) {
    if (!r) return null;
    if (typeof v !== 'number' || !isFinite(v)) return name + ' must be a number';
    if (v < r[0] || v > r[1]) return name + ' must be between ' + r[0] + ' and ' + r[1] + ' (it is ' + v + ')';
    return null;
  };

  const field = (label, el, hint, wide) => { const { h } = ui(); return h('label.chk-field' + (wide ? '.wide' : ''), h('span.chk-lab', label), el, hint ? h('span.chk-hint', hint) : null); };
  K.num = function (o) {
    const { h } = ui();
    const inp = h('input.mono', { type: 'number', id: o.id || null, min: o.min, max: o.max, step: o.step || 1, value: String(o.value === undefined ? '' : o.value), inputmode: 'numeric', 'aria-label': o.label });
    if (o.onChange) inp.addEventListener('input', () => o.onChange(+inp.value));
    return { el: field(o.label, inp, o.hint), input: inp, get: () => (inp.value === '' ? NaN : +inp.value), set(v) { inp.value = String(v); } };
  };
  K.select = function (o) {
    const { h } = ui();
    const sel = h('select', { id: o.id || null, 'aria-label': o.label }, ...(o.options || []).map((op) => h('option', { value: String(op.value) }, op.label)));
    sel.value = String(o.value);
    if (o.onChange) sel.addEventListener('change', () => o.onChange(sel.value));
    return { el: field(o.label, sel, o.hint), input: sel, get: () => sel.value, set(v) { sel.value = String(v); } };
  };
  K.toggle = function (o) {
    const { h } = ui();
    const box = h('input', { type: 'checkbox', id: o.id || null, 'aria-label': o.label });
    box.checked = !!o.value;
    if (o.onChange) box.addEventListener('change', () => o.onChange(box.checked));
    const el = h('label.chk-field.chk-toggle', box, h('span.chk-lab', o.label));
    return { el, input: box, get: () => box.checked, set(v) { box.checked = !!v; } };
  };
  K.panel = function (title, ...kids) {
    const { h } = ui();
    return h('section.chk-panel', title ? h('h3.chk-title', title) : null, ...kids);
  };

  // ---- C answers ----------------------------------------------------------------------------------------------
  K.bareCode = (src) => String(src || '')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '')
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "' '");
  K.cLimits = function (x, src) {
    const L = x.limits || {}, out = [], bare = K.bareCode(src);
    for (const name of L.forbid || []) if (new RegExp('\\b' + name + '\\s*\\(').test(bare)) out.push('it calls ' + name + ', which this challenge does not allow');
    const lines = String(src || '').split('\n').filter((l) => l.trim()).length;
    if (L.maxLines && lines > L.maxLines) out.push('it has ' + lines + ' lines of code, more than the ' + L.maxLines + ' allowed');
    if (L.noMain && /\bint\s+main\s*\(/.test(bare)) out.push('it has a main function, but the hidden tests bring their own main');
    return out;
  };
  K.cLimitSentences = function (x) {
    const L = x.limits || {}, out = [];
    if ((L.forbid || []).length) out.push('No calls to ' + L.forbid.map((f) => '`' + f + '`').join(', ') + '.');
    if (L.maxLines) out.push('At most ' + L.maxLines + ' non-blank lines.');
    if (L.noMain) out.push('No `main`: each hidden test supplies its own `main` and calls your functions.');
    return out;
  };
  /** compile a C program, or the error to show: {err} | {ok: true} */
  K.compiles = function (src) {
    try { if (S.CLang && S.CLang.compile) S.CLang.compile(src); return { ok: true }; } catch (e) { return { err: e }; }
  };

  K.codeWorkspace = function (host, x, draft, onChange, o) {
    const { h, icon } = ui();
    o = o || {};
    const start = draft && typeof draft === 'object' ? draft.src : typeof draft === 'string' ? draft : '';
    const left = h('div.chk-code');
    const out = h('pre.chk-out.mono', { id: 'chOut', 'aria-live': 'polite' }, o.idle || 'Run it to see what it prints.');
    const status = h('div.chk-status', { id: 'chStatus' });
    const tryBtn = h('button.btn', { type: 'button', id: 'btnTry' }, icon('run'), o.tryLabel || 'Try it');
    let shown = null;
    if (o.show) {
      const lines = S.LabEditor.highlight(o.show.src);
      shown = h('details.chk-shown', h('summary', o.show.title || 'The sample test'), h('pre.chk-listing.mono', { html: lines.map((l) => '<span class="ck-line">' + (l || ' ') + '</span>').join('\n') }));
    }
    const right = h('div.chk-side', h('div.chk-side-head', h('b', o.sideTitle || 'Try it'), tryBtn), o.tryInput ? o.tryInput.el : null, status, out, o.note ? h('p.chk-note', ui().inline(o.note)) : null, shown);
    host.appendChild(h('div.chk-codegrid', left, right));
    const ed = S.LabEditor.create(left, { value: start, id: 'chEditor', label: 'Your code', files: 'ch:' + x.id, minLines: 18, maxHeight: 560, onChange: () => onChange && onChange(), onRun: () => tryBtn.click() });
    tryBtn.addEventListener('click', () => {
      const src = ed.get();
      const c = K.compiles(o.prefix ? o.prefix(src) : src);
      if (c.err) {
        const e = c.err, at = o.lineOf ? o.lineOf(e) : e;
        if (at && at.line > 0 && at.line <= src.split('\n').length) ed.setError(at); else ed.setError(null);
        status.className = 'chk-status bad'; status.textContent = 'It does not compile: ' + (e.msg || e.message);
        out.textContent = ''; out.hidden = true;
        return;
      }
      ed.setError(null);
      out.hidden = false;
      let r;
      try { r = o.tryIt(src); } catch (e) { r = { ok: false, say: String(e.message || e), out: '' }; }
      status.className = 'chk-status ' + (r.ok ? 'ok' : 'bad');
      status.textContent = r.say || '';
      out.textContent = r.out === undefined || r.out === '' ? '(nothing printed)' : r.out;
    });
    return {
      ed,
      get: () => ({ src: ed.get() }),
      load(a) { ed.set(a && typeof a === 'object' ? a.src : String(a || '')); },
      redraw() { ed.redraw(); },
      dispose() { ed.dispose(); },
    };
  };
})(globalThis.Proses = globalThis.Proses || {});

// ---- what the diagram checker looks at: each kind's workspace, on its sample challenge ----------------------------------
(function (S) {
  'use strict';
  if (!S.Checks || S.Checks.some((c) => c.name === 'workspace: sched-tune')) return;
  const IDS = { 'sched-tune': 'sample-sched-tune', 'sync-solution': 'sample-sync-mailbox', 'pt-design': 'sample-pt-budget', 'disk-sched': 'sample-disk-budget', shell: 'sample-shell-jobs' };
  for (const [k, id] of Object.entries(IDS)) {
    S.Checks.push({
      group: 'challenge-workspaces', name: 'workspace: ' + k, hash: 'challenge/' + id, fresh: true, sel: '#main',
      setup: `if (!Proses.Content.challenges.has('${id}')) { Proses.Content.challenge(Proses.Challenges.kinds['${k}'].example()); Proses.app.route(); } await new Promise((r) => setTimeout(r, 300));`,
      ready: `!!document.querySelector('#challengeView #chWork > *')`,
    });
  }
})(globalThis.Proses = globalThis.Proses || {});
