// The lab shell's setup panel: the inputs a lab declares, drawn as real controls, with the lab's presets as chips.
// A lab's setup is {fields: [field..], presets: [{label, values}], check(values) -> 'why not' | null}. A field is
//   {id, label, type, def, help, group (a heading over it and the fields after it), show(values) -> bool, ...}
//   type 'select'  options: [{value, label}]           'number' min, max, step, integer (default true), unit
//        'text'    placeholder, pattern, patternWhy     'toggle' def true | false (on and off: the values, default
//        'slider'  min, max, step, fmt(v), log                    true and false)
//        'table'   columns, minRows, maxRows, newRow, check (S.LabWidgets.table)
//        'list'    kind, min, max, minLen, maxLen, names (S.LabWidgets.list)
//        'matrix'  rows, cols, min, max, resize, rowName, colName (S.LabWidgets.matrix); the value is [[..]..]
//        'code'    examples: [{name, src}], files (namespace for saved programs), minLines (S.LabEditor)
//   live: false  a change waits for Run (the default for code; every other field runs again at once)
//   S.LabSetup.defaults(lab) -> values      S.LabSetup.check(lab, values) -> 'why not' | null (node too)
//   Several code fields may sit in one setup: each has its own editor (api.editors[id]); api.editor is the first.
//   S.LabSetup.build(host, lab, values, onChange(values, live)) -> {get(), set(values), valid(), errors(), editor, editors,
//     widgets: {id: widget}, field(id) -> element}
(function (S) {
  'use strict';
  const LS = (S.LabSetup = S.LabSetup || {});
  const fieldsOf = (lab) => ((lab.setup && lab.setup.fields) || []);
  const copy = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

  LS.defaults = function (lab) {
    const o = {};
    for (const f of fieldsOf(lab)) {
      let d = typeof f.def === 'function' ? f.def() : f.def;
      if (d === undefined) d = f.type === 'toggle' ? (f.off !== undefined ? f.off : false) : f.type === 'select' ? (f.options[0] || {}).value : f.type === 'number' || f.type === 'slider' ? (f.min || 0) : f.type === 'table' || f.type === 'list' || f.type === 'matrix' ? [] : '';
      o[f.id] = copy(d);
    }
    return o;
  };
  /** values given (a preset, a share link) laid over the defaults, keeping only the lab's own fields */
  LS.merge = function (lab, given) {
    const o = LS.defaults(lab);
    for (const f of fieldsOf(lab)) if (given && given[f.id] !== undefined) o[f.id] = copy(given[f.id]);
    return o;
  };
  LS.check = function (lab, v) {
    const W = S.LabWidgets;
    for (const f of fieldsOf(lab)) {
      if (f.show && !f.show(v)) continue;
      const x = v[f.id], L = f.label || f.id;
      if (f.type === 'number' || f.type === 'slider') {
        if (typeof x !== 'number' || !Number.isFinite(x)) return L + ': a number is needed';
        if (f.type === 'number' && f.integer !== false && !Number.isInteger(x)) return L + ': a whole number is needed';
        if (f.min !== undefined && x < f.min) return L + ': at least ' + f.min;
        if (f.max !== undefined && x > f.max) return L + ': at most ' + f.max;
      }
      if (f.type === 'select' && !(f.options || []).some((o) => o.value === x)) return L + ': choose one of the options';
      if (f.type === 'list' && W) { const p = W.parseList((x || []).join(' '), f); if (p.error) return L + ': ' + p.error; }
      if (f.type === 'table' && W) {
        if (!Array.isArray(x)) return L + ': a table is needed';
        if (f.minRows !== undefined && x.length < f.minRows) return L + ': at least ' + f.minRows + ' rows';
        if (f.maxRows !== undefined && x.length > f.maxRows) return L + ': at most ' + f.maxRows + ' rows';
        for (let i = 0; i < x.length; i++) for (const c of f.columns) { const p = W.parseCell(c, Array.isArray(x[i][c.id]) ? x[i][c.id].join(' ') : x[i][c.id]); if (p.error) return L + ', row ' + (i + 1) + ', ' + c.label + ': ' + p.error; }
        if (f.check) for (let i = 0; i < x.length; i++) { const why = f.check(x[i], i, x); if (why) return L + ', row ' + (i + 1) + ': ' + (typeof why === 'string' ? why : Object.values(why)[0]); }
      }
      if (f.type === 'matrix') {
        if (!Array.isArray(x) || x.some((r) => !Array.isArray(r) || r.some((c) => !Number.isInteger(c)))) return L + ': whole numbers in every cell';
        if (x.some((r) => r.some((c) => (f.min !== undefined ? c < f.min : c < 0) || (f.max !== undefined && c > f.max)))) return L + ': each cell between ' + (f.min || 0) + ' and ' + (f.max === undefined ? 'any' : f.max);
      }
      if (f.check && f.type !== 'table') { const e = f.check(x, v); if (e) return e; }
    }
    return lab.setup && lab.setup.check ? lab.setup.check(v) || null : null;
  };

  LS.build = function (host, lab, values, onChange) {
    const { h, icon } = S.UI;
    const W = S.LabWidgets;
    let v = LS.merge(lab, values);
    const widgets = {}, rows = {};
    let editor = null;
    const editors = {};
    const box = h('div.lab-setup', { id: 'labSetup' });
    const err = h('div.lab-err', { id: 'labSetupErr', role: 'alert' });
    const presets = (lab.setup && lab.setup.presets) || [];
    let chips = null;
    if (presets.length) {
      chips = h('div.lab-presets', { role: 'group', 'aria-label': 'Presets' });
      presets.forEach((p, k) => {
        const c = h('button.chip', { type: 'button', dataset: { preset: String(k) } }, p.label);
        c.addEventListener('click', () => { api.set(LS.merge(lab, Object.assign({}, LS.defaults(lab), p.values))); fire(true); });
        chips.appendChild(c);
      });
      box.appendChild(h('div.lab-sec', h('div.lab-sec-h', 'Presets'), chips));
    }
    const fire = (live) => {
      const e = api.errors();
      err.textContent = e[0] || '';
      markPresets();
      showHide();
      if (!e.length && onChange) onChange(api.get(), live);
    };
    function markPresets() {
      if (!chips) return;
      const cur = JSON.stringify(api.get());
      presets.forEach((p, k) => { const on = JSON.stringify(LS.merge(lab, Object.assign({}, LS.defaults(lab), p.values))) === cur; chips.children[k].classList.toggle('on', on); chips.children[k].setAttribute('aria-pressed', String(on)); });
    }
    function showHide() { for (const f of fieldsOf(lab)) if (rows[f.id]) rows[f.id].hidden = !!(f.show && !f.show(v)); }
    let group = null, sec = null;
    for (const f of fieldsOf(lab)) {
      if (!sec || (f.group && f.group !== group)) { group = f.group || null; sec = h('div.lab-sec', group ? h('div.lab-sec-h', group) : null); box.appendChild(sec); }
      const id = 'lab-' + f.id;
      const live = f.live !== undefined ? f.live : f.type !== 'code';
      const row = h('div.lab-field.t-' + f.type + (f.wide || ['table', 'list', 'matrix', 'code'].includes(f.type) ? '.wide' : ''), { dataset: { field: f.id } });
      const label = h('label.lab-label', { for: id }, f.label || f.id, f.unit ? h('span.lab-unit', ' (' + f.unit + ')') : null);
      const help = f.help ? h('div.lab-help', S.UI.inline(f.help)) : null;
      let ctl = null;
      if (f.type === 'select') {
        ctl = h('select', { id }, ...(f.options || []).map((o, k) => h('option', { value: String(k) }, o.label)));
        const sync = () => { const k = (f.options || []).findIndex((o) => o.value === v[f.id]); ctl.value = String(Math.max(0, k)); };
        sync();
        ctl.addEventListener('change', () => { v[f.id] = f.options[+ctl.value].value; fire(live); });
        widgets[f.id] = { get: () => v[f.id], set: sync, valid: () => true, errors: () => [] };
        row.append(label, ctl);
      } else if (f.type === 'toggle') {
        const on = f.on !== undefined ? f.on : true, off = f.off !== undefined ? f.off : false;
        ctl = h('input', { type: 'checkbox', id, role: 'switch' });
        const sync = () => { ctl.checked = v[f.id] === on; };
        sync();
        ctl.addEventListener('change', () => { v[f.id] = ctl.checked ? on : off; fire(live); });
        widgets[f.id] = { get: () => v[f.id], set: sync, valid: () => true, errors: () => [] };
        row.append(h('label.lab-toggle', ctl, h('span.lab-switch', { 'aria-hidden': 'true' }), h('span', f.label || f.id)));
      } else if (f.type === 'number' || f.type === 'text') {
        ctl = h('input' + (f.type === 'number' ? '.mono' : ''), { type: 'text', id, inputmode: f.type === 'number' ? (f.integer === false ? 'decimal' : 'numeric') : null, spellcheck: 'false', autocomplete: 'off', placeholder: f.placeholder || '' });
        const sync = () => { ctl.value = v[f.id] === undefined ? '' : String(v[f.id]); ctl.classList.remove('bad'); };
        sync();
        let bad = null;
        const read = () => {
          const col = f.type === 'number' ? { type: f.integer === false ? 'number' : 'int', min: f.min, max: f.max } : { type: 'text', pattern: f.pattern, patternWhy: f.patternWhy, maxLen: f.maxLen, required: f.required };
          const p = W.parseCell(col, ctl.value);
          bad = p.error ? (f.label || f.id) + ': ' + p.error + '.' : null;
          ctl.classList.toggle('bad', !!bad);
          ctl.title = bad || '';
          if (!bad) v[f.id] = p.value;
        };
        ctl.addEventListener('input', () => { read(); fire(live); });
        if (f.type === 'number') ctl.addEventListener('keydown', (e) => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
          e.preventDefault();
          const st = f.step || 1, cur = Number(ctl.value) || 0;
          let n = cur + (e.key === 'ArrowUp' ? st : -st);
          if (f.min !== undefined) n = Math.max(f.min, n);
          if (f.max !== undefined) n = Math.min(f.max, n);
          ctl.value = String(+n.toFixed(6)); read(); fire(live);
        });
        widgets[f.id] = { get: () => v[f.id], set: sync, valid: () => !bad, errors: () => (bad ? [bad] : []) };
        row.append(label, ctl);
      } else if (f.type === 'slider') {
        const toPos = (x) => (f.log ? Math.log10(x) : x), toVal = (q) => (f.log ? +Math.pow(10, q).toPrecision(3) : q);
        const fmt = f.fmt || ((x) => String(+(+x).toPrecision(4)));
        const out = h('output.mono');
        ctl = h('input', { type: 'range', id, min: toPos(f.min), max: toPos(f.max), step: f.step || (f.log ? 0.05 : 1) });
        const sync = () => { ctl.value = String(toPos(v[f.id])); out.textContent = fmt(v[f.id]); };
        sync();
        ctl.addEventListener('input', () => { v[f.id] = toVal(+ctl.value); out.textContent = fmt(v[f.id]); fire(live); });
        widgets[f.id] = { get: () => v[f.id], set: sync, valid: () => true, errors: () => [] };
        row.append(label, h('div.lab-slider', ctl, out));
      } else if (f.type === 'table' || f.type === 'list' || f.type === 'matrix') {
        row.append(label);
        const mat = f.type === 'matrix';
        const rowNames = () => (f.rows ? (typeof f.rows === 'function' ? f.rows(v) : f.rows) : (v[f.id] || []).map((r, i) => (f.rowName ? f.rowName(i) : 'P' + i)));
        const colNames = () => (f.cols ? (typeof f.cols === 'function' ? f.cols(v) : f.cols) : ((v[f.id] || [])[0] || []).map((c, j) => (f.colName ? f.colName(j) : String.fromCharCode(65 + j))));
        const w = W[f.type](row, Object.assign({}, f, { id, value: v[f.id], rows: f.type === 'table' ? v[f.id] : mat ? rowNames() : undefined, cols: mat ? colNames() : undefined, onChange: (val) => { v[f.id] = val; fire(live); } }));
        // the widget reports its own errors; a change that leaves it invalid still updates the line under the panel
        w.el.addEventListener('input', () => { if (!w.valid()) fire(live); });
        widgets[f.id] = { get: () => w.get(), set: () => (mat ? w.set(v[f.id], rowNames(), colNames()) : w.set(v[f.id])), valid: () => w.valid(), errors: () => w.errors().map((e) => (f.label || f.id) + ': ' + e) };
      } else if (f.type === 'code') {
        row.append(h('div.lab-label', f.label || 'Program'));
        const ed = S.LabEditor.create(row, { id, value: v[f.id], files: f.files === false ? null : f.files || 'lab:' + lab.id, examples: f.examples, minLines: f.minLines || 12, maxHeight: f.maxHeight || 560, onChange: (t) => { v[f.id] = t; fire(false); }, onRun: () => { if (api.onRun) api.onRun(); } });
        editors[f.id] = ed;
        if (!editor) editor = ed;
        // each code field keeps its own editor in this closure, so setting one never touches another
        widgets[f.id] = { get: () => ed.get(), set: () => ed.set(v[f.id]), valid: () => true, errors: () => [] };
      }
      if (help) row.appendChild(help);
      rows[f.id] = row;
      sec.appendChild(row);
    }
    box.appendChild(err);
    host.appendChild(box);
    const api = {
      el: box, editor, editors, widgets,
      get: () => copy(v),
      set(next) { v = LS.merge(lab, next); for (const [id, w] of Object.entries(widgets)) { w.set(v[id]); } err.textContent = ''; markPresets(); showHide(); },
      errors() {
        const e = [];
        for (const f of fieldsOf(lab)) { if (f.show && !f.show(v)) continue; const w = widgets[f.id]; if (w && !w.valid()) e.push(...w.errors()); }
        if (!e.length) { const c = LS.check(lab, v); if (c) e.push(c.replace(/[.]?$/, '.')); }
        return e;
      },
      valid: () => !api.errors().length,
      field: (id) => rows[id] || null,
      onRun: null,
    };
    markPresets();
    showHide();
    return api;
  };
})(globalThis.Proses = globalThis.Proses || {});
