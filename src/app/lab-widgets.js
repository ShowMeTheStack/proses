// Typed-data widgets for the labs' setup panels: a table editor (a workload: rows of fields, each checked), a list
// editor (a reference string, a disk request queue) and a matrix editor (Allocation, Max). Each one keeps its value
// typed, marks a bad field in place with the reason, and says what is wrong in one line under it.
//   S.LabWidgets.table(host, {id, columns: [{id, label, type: 'int' | 'number' | 'text' | 'ints' | 'select', min, max,
//       options: [{value, label}], width, def, title}], rows: [{..}], minRows, maxRows, newRow(i, rows) -> row,
//       check(row, i, rows) -> {field: 'why'} | 'why' | null, onChange(rows), addLabel})
//     'ints' is a list of whole numbers in one cell, typed "3 2 4" (CPU and I/O bursts)
//   S.LabWidgets.list(host, {id, label, value: [..], kind: 'int' | 'text', min, max, minLen, maxLen, placeholder,
//       onChange(list), names(i) -> label under chip i})
//   S.LabWidgets.matrix(host, {id, title, rows: [name..], cols: [name..], value: [[..]..], min, max, resize: true,
//       rowName(i), colName(j), onChange(value, rows, cols)})
//   Every widget returns {el, get(), set(value), valid() -> bool, errors() -> [sentences]}.
//   Parsing, for node too: S.LabWidgets.parseCell(col, text) -> {value} | {error}
//                          S.LabWidgets.parseList(text, {kind, min, max, minLen, maxLen}) -> {value} | {error}
(function (S) {
  'use strict';
  const W = (S.LabWidgets = S.LabWidgets || {});
  const whole = (t) => /^-?\d+$/.test(String(t).trim());

  W.parseCell = function (col, text) {
    const t = String(text === undefined || text === null ? '' : text).trim().replace(/−/g, '-');
    const range = (v) => (col.min !== undefined && v < col.min ? 'at least ' + col.min : col.max !== undefined && v > col.max ? 'at most ' + col.max : null);
    switch (col.type) {
      case 'int': {
        if (!t) return { error: 'a whole number is needed' };
        if (!whole(t)) return { error: '"' + t + '" is not a whole number' };
        const v = +t, r = range(v);
        return r ? { error: r } : { value: v };
      }
      case 'number': {
        if (!t) return { error: 'a number is needed' };
        const v = Number(t);
        if (!Number.isFinite(v)) return { error: '"' + t + '" is not a number' };
        const r = range(v);
        return r ? { error: r } : { value: v };
      }
      case 'ints': {
        const parts = t.split(/[\s,]+/).filter(Boolean);
        if (!parts.length) return { error: 'at least one number is needed' };
        const bad = parts.find((p) => !whole(p));
        if (bad !== undefined) return { error: '"' + bad + '" is not a whole number' };
        const v = parts.map(Number), off = v.find((x) => range(x));
        if (off !== undefined) return { error: 'each number ' + range(off) };
        if (col.odd && v.length % 2 === 0) return { error: col.odd };
        if (col.maxLen && v.length > col.maxLen) return { error: 'at most ' + col.maxLen + ' numbers' };
        return { value: v };
      }
      case 'select': return (col.options || []).some((o) => String(o.value) === t) ? { value: (col.options.find((o) => String(o.value) === t) || {}).value } : { error: 'choose one of the options' };
      default: {
        if (!t && col.required !== false) return { error: 'this cannot be empty' };
        if (col.pattern && !new RegExp(col.pattern).test(t)) return { error: col.patternWhy || 'this does not have the right form' };
        if (col.maxLen && t.length > col.maxLen) return { error: 'at most ' + col.maxLen + ' characters' };
        return { value: t };
      }
    }
  };
  const showCell = (col, v) => (v === undefined || v === null ? '' : Array.isArray(v) ? v.join(' ') : String(v));

  W.parseList = function (text, o) {
    o = o || {};
    const parts = String(text === undefined || text === null ? '' : text).trim().replace(/−/g, '-').split(/[\s,;]+/).filter(Boolean);
    if (o.minLen !== undefined && parts.length < o.minLen) return { error: 'at least ' + o.minLen + ' item' + (o.minLen === 1 ? '' : 's') + ' are needed' };
    if (o.maxLen !== undefined && parts.length > o.maxLen) return { error: 'at most ' + o.maxLen + ' items, so the picture stays readable (this has ' + parts.length + ')' };
    if ((o.kind || 'int') === 'int') {
      const bad = parts.findIndex((p) => !whole(p));
      if (bad >= 0) return { error: 'item ' + (bad + 1) + ', "' + parts[bad] + '", is not a whole number', at: bad };
      const v = parts.map(Number);
      const lo = v.findIndex((x) => o.min !== undefined && x < o.min), hi = v.findIndex((x) => o.max !== undefined && x > o.max);
      if (lo >= 0) return { error: 'item ' + (lo + 1) + ' is ' + v[lo] + ': each must be at least ' + o.min, at: lo };
      if (hi >= 0) return { error: 'item ' + (hi + 1) + ' is ' + v[hi] + ': each must be at most ' + o.max, at: hi };
      return { value: v };
    }
    return { value: parts };
  };

  /** the line under a widget that says what is wrong */
  const errLine = (h) => h('div.lw-err', { role: 'alert' });
  const setErr = (el, list) => { el.textContent = list.length ? list[0] + (list.length > 1 ? ' (and ' + (list.length - 1) + ' more)' : '') : ''; };

  // ---- the table editor -----------------------------------------------------------------------------------------
  W.table = function (host, o) {
    const { h, icon } = S.UI;
    const cols = o.columns || [];
    let rows = (o.rows || []).map((r) => Object.assign({}, r));
    let errs = [];
    const body = h('tbody');
    const table = h('table.lw-table', { id: o.id || null }, h('thead', h('tr', ...cols.map((c) => h('th', { title: c.title || null, style: c.width ? { width: c.width } : null }, c.label)), h('th.lw-x', { 'aria-label': 'Remove' }))), body);
    const add = h('button.btn.small', { type: 'button', title: 'Add a row' }, icon('plus'), o.addLabel || 'Add a row');
    const err = errLine(h);
    const el = h('div.lw.lw-tablebox', h('div.lw-scroll', table), h('div.lw-foot', add, h('span.lw-count')), err);
    const count = el.querySelector('.lw-count');
    const emit = () => { if (o.onChange && api.valid()) o.onChange(api.get()); };
    function validate() {
      errs = [];
      for (const tr of body.children) for (const i of tr.querySelectorAll('[data-col]')) i.classList.remove('bad');
      rows.forEach((r, i) => {
        const tr = body.children[i];
        for (const c of cols) {
          const inp = tr && tr.querySelector('[data-col="' + c.id + '"]');
          const p = W.parseCell(c, inp ? inp.value : showCell(c, r[c.id]));
          if (p.error) { errs.push('Row ' + (i + 1) + ', ' + c.label + ': ' + p.error + '.'); if (inp) { inp.classList.add('bad'); inp.title = p.error; } }
          else { r[c.id] = p.value; if (inp) inp.title = ''; }
        }
      });
      if (!errs.length && o.check) rows.forEach((r, i) => {
        const why = o.check(r, i, rows);
        if (!why) return;
        if (typeof why === 'string') { errs.push('Row ' + (i + 1) + ': ' + why + '.'); return; }
        for (const [k, msg] of Object.entries(why)) { errs.push('Row ' + (i + 1) + ', ' + ((cols.find((c) => c.id === k) || {}).label || k) + ': ' + msg + '.'); const inp = body.children[i] && body.children[i].querySelector('[data-col="' + k + '"]'); if (inp) { inp.classList.add('bad'); inp.title = msg; } }
      });
      setErr(err, errs);
      count.textContent = rows.length + ' row' + (rows.length === 1 ? '' : 's');
      add.disabled = o.maxRows !== undefined && rows.length >= o.maxRows;
      for (const b of body.querySelectorAll('.lw-del')) b.disabled = rows.length <= (o.minRows || 1);
    }
    function render() {
      body.innerHTML = '';
      rows.forEach((r, i) => {
        const tr = h('tr');
        for (const c of cols) {
          let inp;
          const label = c.label + ', row ' + (i + 1);
          if (c.type === 'select') {
            inp = h('select', { 'aria-label': label, dataset: { col: c.id } }, ...(c.options || []).map((op) => h('option', { value: String(op.value) }, op.label)));
            inp.value = String(r[c.id] === undefined ? (c.options[0] || {}).value : r[c.id]);
          } else {
            inp = h('input' + (c.type === 'text' ? '' : '.mono'), { type: 'text', 'aria-label': label, spellcheck: 'false', autocomplete: 'off', inputmode: c.type === 'int' ? 'numeric' : null, placeholder: c.placeholder || '', dataset: { col: c.id } });
            inp.value = showCell(c, r[c.id]);
          }
          inp.addEventListener(c.type === 'select' ? 'change' : 'input', () => { validate(); emit(); });
          tr.appendChild(h('td', inp));
        }
        const del = h('button.icon-btn.lw-del', { type: 'button', title: 'Remove row ' + (i + 1), 'aria-label': 'Remove row ' + (i + 1) }, icon('x'));
        del.addEventListener('click', () => { rows.splice(i, 1); render(); emit(); });
        tr.appendChild(h('td.lw-x', del));
        body.appendChild(tr);
      });
      validate();
    }
    add.addEventListener('click', () => {
      const fresh = o.newRow ? o.newRow(rows.length, rows) : Object.fromEntries(cols.map((c) => [c.id, c.def !== undefined ? c.def : c.type === 'select' ? (c.options[0] || {}).value : '']));
      rows.push(fresh); render(); emit();
      const last = body.lastElementChild && body.lastElementChild.querySelector('input, select');
      if (last) last.focus();
    });
    const api = {
      el,
      get: () => rows.map((r) => Object.assign({}, r)),
      set(v) { rows = (v || []).map((r) => Object.assign({}, r)); render(); },
      valid: () => !errs.length,
      errors: () => errs.slice(),
    };
    render();
    host.appendChild(el);
    return api;
  };

  // ---- the list editor ------------------------------------------------------------------------------------------
  W.list = function (host, o) {
    const { h } = S.UI;
    let value = (o.value || []).slice(), errs = [];
    const inp = h('input.mono.lw-listin', { type: 'text', id: o.id || null, 'aria-label': o.label || 'List', spellcheck: 'false', autocomplete: 'off', placeholder: o.placeholder || '7 0 1 2 0 3' });
    inp.value = value.join(' ');
    const chips = h('div.lw-chips', { 'aria-hidden': 'true' });
    const err = errLine(h);
    const el = h('div.lw.lw-list', inp, chips, err);
    function draw(bad) {
      chips.innerHTML = '';
      const shown = bad ? String(inp.value).trim().split(/[\s,;]+/).filter(Boolean) : value;
      shown.forEach((v, i) => chips.appendChild(h('span.lw-chip' + (bad && bad.at === i ? '.bad' : ''), h('b', String(v)), h('i', o.names ? o.names(i) : String(i + 1)))));
    }
    function read() {
      const p = W.parseList(inp.value, o);
      errs = p.error ? [p.error.replace(/^./, (c) => c.toUpperCase()) + '.'] : [];
      inp.classList.toggle('bad', !!p.error);
      setErr(err, errs);
      if (!p.error) value = p.value;
      draw(p.error ? p : null);
      return !p.error;
    }
    inp.addEventListener('input', () => { if (read() && o.onChange) o.onChange(value.slice()); });
    read();
    host.appendChild(el);
    return {
      el,
      get: () => value.slice(),
      set(v) { inp.value = (v || []).join(' '); read(); },
      valid: () => !errs.length,
      errors: () => errs.slice(),
    };
  };

  // ---- the matrix editor ----------------------------------------------------------------------------------------
  W.matrix = function (host, o) {
    const { h } = S.UI;
    let rows = (o.rows || []).slice(), cols = (o.cols || []).slice();
    let value = (o.value || rows.map(() => cols.map(() => 0))).map((r) => r.slice());
    let errs = [];
    const rowName = o.rowName || ((i) => 'P' + i), colName = o.colName || ((j) => String.fromCharCode(65 + j));
    const grid = h('table.lw-matrix', { id: o.id || null });
    const err = errLine(h);
    const tools = h('div.lw-foot');
    const el = h('div.lw.lw-matbox', o.title ? h('div.lw-title', o.title) : null, h('div.lw-scroll', grid), tools, err);
    const btn = (label, title, fn) => { const b = h('button.btn.small.lw-mbtn', { type: 'button', title }, label); b.addEventListener('click', fn); return b; };
    if (o.resize) {
      tools.append(
        btn('+ row', 'Add a row', () => { rows.push(rowName(rows.length)); value.push(cols.map(() => 0)); render(); emit(); }),
        btn('− row', 'Remove the last row', () => { if (rows.length > 1) { rows.pop(); value.pop(); render(); emit(); } }),
        btn('+ column', 'Add a column', () => { cols.push(colName(cols.length)); value.forEach((r) => r.push(0)); render(); emit(); }),
        btn('− column', 'Remove the last column', () => { if (cols.length > 1) { cols.pop(); value.forEach((r) => r.pop()); render(); emit(); } }));
    } else tools.remove();
    const emit = () => { if (o.onChange && !errs.length) o.onChange(api.get(), rows.slice(), cols.slice()); };
    function validate() {
      errs = [];
      const col = { type: 'int', min: o.min === undefined ? 0 : o.min, max: o.max };
      grid.querySelectorAll('input').forEach((inp) => {
        const i = +inp.dataset.i, j = +inp.dataset.j, p = W.parseCell(col, inp.value);
        inp.classList.toggle('bad', !!p.error);
        inp.title = p.error || '';
        if (p.error) errs.push(rows[i] + ', ' + cols[j] + ': ' + p.error + '.'); else value[i][j] = p.value;
      });
      setErr(err, errs);
    }
    function render() {
      grid.innerHTML = '';
      grid.appendChild(h('thead', h('tr', h('th'), ...cols.map((c) => h('th', c)))));
      const tb = h('tbody');
      rows.forEach((r, i) => {
        tb.appendChild(h('tr', h('th', r), ...cols.map((c, j) => {
          const inp = h('input.mono', { type: 'text', inputmode: 'numeric', 'aria-label': (o.title ? o.title + ', ' : '') + r + ', ' + c, dataset: { i: String(i), j: String(j) }, autocomplete: 'off' });
          inp.value = String(value[i][j] === undefined ? 0 : value[i][j]);
          inp.addEventListener('input', () => { validate(); emit(); });
          inp.addEventListener('keydown', (e) => {
            const go = { ArrowUp: [-1, 0], ArrowDown: [1, 0], Enter: [1, 0] }[e.key];
            if (!go) return;
            const n = grid.querySelector('input[data-i="' + (i + go[0]) + '"][data-j="' + (j + go[1]) + '"]');
            if (n) { e.preventDefault(); n.focus(); n.select(); }
          });
          return h('td', inp);
        })));
      });
      grid.appendChild(tb);
      validate();
    }
    const api = {
      el,
      get: () => value.map((r) => r.slice()),
      set(v, r, c) { if (r) rows = r.slice(); if (c) cols = c.slice(); value = (v || []).map((x) => x.slice()); render(); },
      names: () => ({ rows: rows.slice(), cols: cols.slice() }),
      valid: () => !errs.length,
      errors: () => errs.slice(),
    };
    render();
    host.appendChild(el);
    return api;
  };
})(globalThis.Proses = globalThis.Proses || {});
